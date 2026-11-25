import { describe, expect, it } from 'vitest';
import { GATES, STICK, clampToRadius, gateAngle, gateFromVector, gateOf, gateVector, leverTilt, type StickGate } from '../../../src/ui/stickMath';

/** A push of length `push` (0..1) at `deg` degrees (counter-clockwise from right, screen up positive). */
const at = (deg: number, push: number) => {
  const a = (deg * Math.PI) / 180;
  return { nx: Math.cos(a) * push, ny: -Math.sin(a) * push };
};
const gate = (deg: number, push = 0.8, previous: StickGate | null = null) => {
  const p = at(deg, push);
  return gateOf(p.nx, p.ny, previous);
};

describe('joystick gate maths', () => {
  it('has a dead zone of about a quarter of the radius', () => {
    expect(STICK.deadZone).toBeCloseTo(0.25, 2);
    for (const deg of [0, 37, 90, 200, 315]) {
      expect(gate(deg, 0), `${deg}° centred`).toBeNull();
      expect(gate(deg, 0.1), `${deg}° small wobble`).toBeNull();
      expect(gate(deg, STICK.deadZone - 0.01), `${deg}° just inside`).toBeNull();
      expect(gate(deg, STICK.deadZone + 0.01), `${deg}° just outside`).not.toBeNull();
    }
  });

  it('snaps to eight 45° sectors centred on the straight and diagonal directions', () => {
    const expected: [number, StickGate][] = [
      [0, 'right'],
      [45, 'right_back'],
      [90, 'back'],
      [135, 'left_back'],
      [180, 'left'],
      [225, 'left_front'],
      [270, 'front'],
      [315, 'right_front'],
    ];
    for (const [deg, g] of expected) {
      expect(gate(deg), `${deg}°`).toBe(g);
      // Anywhere inside the sector (±22° around its centre) gives the same gate.
      expect(gate(deg - 22), `${deg - 22}°`).toBe(g);
      expect(gate(deg + 22), `${deg + 22}°`).toBe(g);
      expect(gateAngle(g)).toBe(deg);
    }
    // Sector edges: just past 22.5° belongs to the next gate.
    expect(gate(23)).toBe('right_back');
    expect(gate(-23)).toBe('right_front');
    expect(GATES).toHaveLength(8);
  });

  it('uses screen axes: up on the screen is the back of the machine, right is right', () => {
    // Pointer offsets: y grows downwards on screen.
    expect(gateOf(0, -0.9)).toBe('back');
    expect(gateOf(0, 0.9)).toBe('front');
    expect(gateOf(0.9, 0)).toBe('right');
    expect(gateOf(-0.9, 0)).toBe('left');
    expect(gateOf(0.6, -0.6)).toBe('right_back');
    expect(gateOf(-0.6, 0.6)).toBe('left_front');
  });

  it('maps gates to game input: x right +1, z toward the player +1, diagonals on both axes', () => {
    expect(gateVector(null)).toEqual({ x: 0, z: 0 });
    expect(gateVector('right')).toEqual({ x: 1, z: 0 });
    expect(gateVector('left')).toEqual({ x: -1, z: 0 });
    expect(gateVector('back')).toEqual({ x: 0, z: -1 });
    expect(gateVector('front')).toEqual({ x: 0, z: 1 });
    expect(gateVector('right_back')).toEqual({ x: 1, z: -1 });
    expect(gateVector('right_front')).toEqual({ x: 1, z: 1 });
    expect(gateVector('left_back')).toEqual({ x: -1, z: -1 });
    expect(gateVector('left_front')).toEqual({ x: -1, z: 1 });
    // Round trip for every gate, and the keyboard's sign vectors map back onto gates.
    for (const g of GATES) expect(gateFromVector(gateVector(g).x, gateVector(g).z)).toBe(g);
    expect(gateFromVector(0, 0)).toBeNull();
    expect(gateFromVector(0.3, -2)).toBe('right_back');
  });

  it('holds the engaged gate through small wobbles (no chatter), then releases', () => {
    // Engaged "right": a wobble a few degrees past the sector edge keeps it.
    expect(gate(22.5 + STICK.sectorHold - 1, 0.8, 'right')).toBe('right');
    expect(gate(-(22.5 + STICK.sectorHold - 1), 0.8, 'right')).toBe('right');
    // Clearly into the next sector: the gate changes.
    expect(gate(22.5 + STICK.sectorHold + 2, 0.8, 'right')).toBe('right_back');
    // Pulling back toward the centre: still engaged inside the dead zone, released under the release zone.
    expect(gate(0, (STICK.deadZone + STICK.releaseZone) / 2, 'right')).toBe('right');
    expect(gate(0, STICK.releaseZone - 0.01, 'right')).toBeNull();
    // Without a previous gate the same push inside the dead zone does nothing.
    expect(gate(0, (STICK.deadZone + STICK.releaseZone) / 2)).toBeNull();
    // Release to the centre: nothing is engaged, whatever came before.
    expect(gateOf(0, 0, 'left_front')).toBeNull();
    expect(gateOf(Number.NaN, 0, 'left')).toBeNull();
  });

  it('limits the knob to the travel radius and normalises the push', () => {
    expect(clampToRadius(0, 0, 50)).toEqual({ x: 0, y: 0, nx: 0, ny: 0, push: 0 });
    const inside = clampToRadius(30, -40, 100);
    expect(inside.x).toBeCloseTo(30, 9);
    expect(inside.y).toBeCloseTo(-40, 9);
    expect(inside.push).toBeCloseTo(0.5, 9);
    const outside = clampToRadius(300, 400, 50);
    expect(Math.hypot(outside.x, outside.y)).toBeCloseTo(50, 9);
    expect(outside.nx).toBeCloseTo(0.6, 9);
    expect(outside.ny).toBeCloseTo(0.8, 9);
    expect(outside.push).toBe(1);
    // A drag far past the rim along a diagonal still reads as that diagonal.
    expect(gateOf(clampToRadius(500, -500, 60).nx, clampToRadius(500, -500, 60).ny)).toBe('right_back');
  });

  it('tilts the lever toward the push, never past the largest tilt', () => {
    expect(leverTilt(0, 0)).toEqual({ tiltX: -0, tiltY: 0 });
    expect(leverTilt(1, 0).tiltY).toBeCloseTo(STICK.maxTilt, 9);
    expect(leverTilt(-1, 0).tiltY).toBeCloseTo(-STICK.maxTilt, 9);
    // Up on the screen tips the ball away (positive rotateX), down tips it toward the viewer.
    expect(leverTilt(0, -1).tiltX).toBeCloseTo(STICK.maxTilt, 9);
    expect(leverTilt(0, 1).tiltX).toBeCloseTo(-STICK.maxTilt, 9);
    const d = leverTilt(3, 3);
    expect(Math.hypot(d.tiltX, d.tiltY)).toBeCloseTo(STICK.maxTilt, 9);
  });
});
