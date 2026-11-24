/**
 * One shader pair draws every effects sprite. Each instance is a quad with a
 * packed shape + orientation code (see constants.ts), so a whole family of
 * effects (all additive glows, or all normally blended paper) is one draw call.
 * The additive and the normal batch use the same source and therefore share one
 * compiled program.
 *
 * Instance attributes:
 *   iPos   xyz = position (axial: start point), w = half size (axial: start half-width)
 *   iAxis  billboard / flat: x = extra0, y = extra1, w = rotation
 *          axial: xyz = axis (start → end), w = phase
 *   iColor rgb = linear colour (may exceed 1: bright cores feed the bloom pass), a = alpha
 *   iMeta  x = shape + 32 × mode, y = aux (axial: end half-width; others: softness / variant),
 *          z = cover: how much the sprite hides what is behind it (0 = pure additive light, 1 = opaque paper)
 *
 * Both batches blend premultiplied (ONE, ONE_MINUS_SRC_ALPHA): the fragment adds col × a and
 * hides a × cover of the background. Light that covers a little stays visible on bright cabinets.
 */

export const FX_VERTEX = /* glsl */ `
attribute vec4 iPos;
attribute vec4 iAxis;
attribute vec4 iColor;
attribute vec3 iMeta;
uniform float uCoverGain;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vData;
varying float vAux;
varying float vCover;
void main() {
  float code = iMeta.x;
  float mode = floor( ( code + 0.5 ) / 32.0 );
  float shape = code - mode * 32.0;
  vec2 c = position.xy;
  vUv = c;
  vColor = iColor;
  vData = vec3( shape, iAxis.x, iAxis.y );
  vAux = iMeta.y;
  vCover = iMeta.z >= 0.999 ? 1.0 : clamp( iMeta.z * uCoverGain, 0.0, 1.0 );
  vec3 p;
  if ( mode < 0.5 ) {
    // Billboard: offset in view space (the window camera never rotates, so this is the screen plane).
    float cs = cos( iAxis.w ), sn = sin( iAxis.w );
    vec2 r = vec2( cs * c.x - sn * c.y, sn * c.x + cs * c.y ) * iPos.w;
    p = ( modelViewMatrix * vec4( iPos.xyz, 1.0 ) ).xyz + vec3( r, 0.0 );
  } else if ( mode < 1.5 ) {
    // Flat: a quad lying in the horizontal plane.
    float cs = cos( iAxis.w ), sn = sin( iAxis.w );
    vec2 r = vec2( cs * c.x - sn * c.y, sn * c.x + cs * c.y ) * iPos.w;
    p = ( modelViewMatrix * vec4( iPos.xyz + vec3( r.x, 0.0, r.y ), 1.0 ) ).xyz;
  } else {
    // Axial: from iPos along iAxis, widened sideways towards the viewer.
    vec3 a0 = ( modelViewMatrix * vec4( iPos.xyz, 1.0 ) ).xyz;
    vec3 a1 = ( modelViewMatrix * vec4( iPos.xyz + iAxis.xyz, 1.0 ) ).xyz;
    float t = c.y * 0.5 + 0.5;
    vec3 base = mix( a0, a1, t );
    vec3 side = cross( a1 - a0, base );
    float len = length( side );
    side = len > 1e-9 ? side / len : vec3( 1.0, 0.0, 0.0 );
    p = base + side * c.x * mix( iPos.w, iMeta.y, t );
    vData.y = iAxis.w;
  }
  gl_Position = projectionMatrix * vec4( p, 1.0 );
}
`;

export const FX_FRAGMENT = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vData;
varying float vAux;
varying float vCover;

vec3 fxHue( float h ) {
  return clamp( abs( fract( h + vec3( 0.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 ) - 1.0, 0.0, 1.0 );
}

void main() {
  int shape = int( vData.x + 0.5 );
  vec2 p = vUv;
  float r = length( p );
  // Derivatives are taken outside the shape branches (undefined in non-uniform control flow).
  float fw = fwidth( r );
  vec3 col = vColor.rgb;
  float a = 0.0;
  if ( shape == 0 ) {
    // GLOW
    a = exp( -r * r * 5.0 ) * ( 1.0 - smoothstep( 0.8, 1.0, r ) );
    col *= 1.0 + 1.6 * exp( -r * r * 40.0 );
  } else if ( shape == 1 ) {
    // STAR: four-point sparkle with a bright centre
    vec2 d = abs( p );
    float rays = max( 0.0, 1.0 - ( sqrt( d.x ) + sqrt( d.y ) ) );
    a = clamp( rays * 2.4 + exp( -r * r * 14.0 ) * 0.8, 0.0, 1.0 ) * ( 1.0 - smoothstep( 0.85, 1.0, r ) );
    col *= 1.0 + 2.2 * exp( -r * r * 50.0 );
  } else if ( shape == 2 || shape == 3 ) {
    // RING / RAINBOW_RING: band of thickness vData.z near the rim, vAux = softness
    float th = clamp( vData.z, 0.02, 0.9 );
    float halfW = th * 0.5;
    float d = abs( r - ( 1.0 - halfW ) );
    float aa = max( fw * 1.2, vAux * halfW );
    a = 1.0 - smoothstep( halfW - aa, halfW + aa, d );
    a += vAux * 0.45 * exp( -d * d / ( th * th * 2.5 ) );
    a *= 1.0 - smoothstep( 0.985, 1.0, r );
    if ( shape == 3 ) {
      float lum = max( vColor.r, max( vColor.g, vColor.b ) );
      col = fxHue( atan( p.y, p.x ) * 0.15915 + uTime * 0.35 + vData.y ) * lum * 1.6;
    }
  } else if ( shape == 4 ) {
    // SPARK: axial streak, bright head at the end of the axis
    float t = p.y * 0.5 + 0.5;
    a = exp( -p.x * p.x * 3.5 ) * t * sqrt( t ) * ( 1.0 - smoothstep( 0.88, 1.0, t ) );
    col *= 1.0 + 1.8 * exp( -( 1.0 - t ) * ( 1.0 - t ) * 40.0 - p.x * p.x * 6.0 );
  } else if ( shape == 5 ) {
    // BEAM: light shaft, bright at the source, with drifting dust
    float t = p.y * 0.5 + 0.5;
    float across = 1.0 - p.x * p.x;
    a = across * across * mix( 1.0, 0.3, t ) * smoothstep( 0.0, 0.06, t ) * ( 1.0 - smoothstep( 0.9, 1.0, t ) );
    a *= 0.82 + 0.18 * sin( t * 31.0 - uTime * 1.7 + vData.y );
    col *= 1.0 + 0.7 * exp( -p.x * p.x * 30.0 );
  } else if ( shape == 6 ) {
    // CONFETTI: paper rectangle seen at an angle (vData.y = cos of the flip angle)
    float f = vData.y;
    float h = max( 0.12, abs( f ) );
    vec2 d = abs( p ) - vec2( 0.86, 0.5 * h );
    a = 1.0 - smoothstep( -0.06, 0.04, max( d.x, d.y ) );
    col *= ( f >= 0.0 ? 1.0 : 0.72 ) * ( 0.78 + 0.32 * h );
  } else if ( shape == 7 ) {
    // PETAL: rounded teardrop with a notch, tumbling
    float f = vData.y;
    float h = max( 0.25, abs( f ) );
    vec2 e = vec2( p.x / 0.62, ( p.y + 0.12 * p.x * p.x ) / h );
    float notch = smoothstep( 0.18, 0.0, abs( p.x ) ) * smoothstep( 0.55, 0.9, p.y / h );
    a = ( 1.0 - smoothstep( 0.78, 0.95, length( e ) + 0.18 * e.y ) ) * ( 1.0 - notch );
    col *= mix( 0.86, 1.06, h ) * ( 0.92 + 0.12 * ( 1.0 - r ) );
  } else if ( shape == 8 ) {
    // PAPER_STAR: five points, flipping like a paper cut-out
    float f = vData.y;
    vec2 q = vec2( p.x, p.y / max( 0.22, abs( f ) ) );
    float ang = atan( q.x, q.y );
    float s = 0.5 + 0.5 * cos( 5.0 * ang );
    float edge = mix( 0.46, 0.96, s * s * s );
    a = 1.0 - smoothstep( edge - 0.07, edge + 0.02, length( q ) );
    col *= ( f >= 0.0 ? 1.0 : 0.74 ) * ( 0.85 + 0.25 * ( 1.0 - length( q ) ) );
  } else if ( shape == 9 ) {
    // BUBBLE: thin rim plus a highlight
    a = ( 1.0 - smoothstep( 0.92, 1.0, r ) ) * ( 0.1 + 0.7 * smoothstep( 0.6, 0.93, r ) );
    a += ( 1.0 - smoothstep( 0.0, 0.26, length( p - vec2( -0.34, 0.38 ) ) ) ) * 0.85;
  } else if ( shape == 10 ) {
    // COIN: spinning disc with a rim and a glint
    float f = vData.y;
    vec2 q = vec2( p.x / max( 0.1, abs( f ) ), p.y );
    float rq = length( q );
    a = 1.0 - smoothstep( 0.86, 0.97, rq );
    float rim = smoothstep( 0.6, 0.7, rq );
    float gd = q.x * 0.7 - q.y * 0.7 - 0.35 * f;
    float glint = exp( -gd * gd * 24.0 );
    col = col * mix( 1.1, 0.78, rim ) * ( f >= 0.0 ? 1.0 : 0.82 ) + vec3( 1.0, 0.95, 0.75 ) * glint * 0.9;
  } else if ( shape == 11 ) {
    // PIXEL: square LED / data bit with a faint glow
    vec2 d = abs( p );
    float m = max( d.x, d.y );
    a = max( 1.0 - smoothstep( 0.6, 0.68, m ), 0.32 * exp( -m * m * 5.0 ) );
    col *= m < 0.4 ? 1.45 : 0.95;
  } else if ( shape == 12 ) {
    // PUFF: soft cloud blob, lighter on top
    float ang = atan( p.y, p.x );
    float edge = 0.74 + 0.1 * sin( ang * 5.0 + vAux * 6.28 ) + 0.06 * sin( ang * 9.0 - vAux * 3.1 );
    a = ( 1.0 - smoothstep( edge - 0.42, edge, r ) ) * 0.85;
    col *= 0.88 + 0.22 * ( p.y * 0.5 + 0.5 );
  } else if ( shape == 13 ) {
    // FLAME: tongue pointing up with a hot core
    float w = mix( 1.0, 0.22, clamp( p.y * 0.5 + 0.5, 0.0, 1.0 ) );
    float rr = length( vec2( p.x / w, p.y * 0.95 + 0.05 ) );
    a = 1.0 - smoothstep( 0.35, 1.0, rr );
    col = mix( col, vec3( 1.0, 0.92, 0.62 ) * 2.2, exp( -rr * rr * 5.0 ) );
  } else if ( shape == 14 ) {
    // FLASH
    float k = max( 0.0, 1.0 - r * r );
    a = k * k;
  } else if ( shape == 15 ) {
    // DISC
    float aa = fw * 1.2;
    a = 1.0 - smoothstep( 1.0 - 2.0 * aa, 1.0, r );
  } else {
    // LINE: uniform thin axial line
    a = 1.0 - smoothstep( 0.55, 1.0, abs( p.x ) );
  }
  a = clamp( a, 0.0, 1.0 ) * vColor.a;
  if ( a < 0.002 ) discard;
  gl_FragColor = vec4( col * a, a * vCover );
}
`;
