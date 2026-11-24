import { BufferGeometry, Camera, Group, MeshDepthMaterial, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { EXIT, internals, makeFx, run } from './helpers';

/** Minimal stand-in for the renderer argument of onBeforeRender / onAfterRender. */
function fakeRenderer(target: object | null): WebGLRenderer {
  return { getRenderTarget: () => target } as unknown as WebGLRenderer;
}

describe('fx render passes', () => {
  it('each batch is one single-pass draw (no back/front double pass for transparent double-sided)', () => {
    const fx = makeFx();
    const { addBatch, normBatch } = internals(fx);
    for (const batch of [addBatch, normBatch]) {
      expect(batch.material.transparent).toBe(true);
      expect(batch.material.forceSinglePass).toBe(true);
    }
    fx.dispose();
  });

  it('draws only in the main view: not with an override material, not into a reflection cube', () => {
    const fx = makeFx();
    fx.celebrate('legendary', EXIT);
    run(fx, 0.3);
    const { addBatch } = internals(fx);
    const mesh = addBatch.mesh;
    const geometry = mesh.geometry as BufferGeometry & { instanceCount: number };
    const drawn = geometry.instanceCount;
    expect(drawn).toBeGreaterThan(0);
    const scene = new Scene();
    const camera = new Camera();
    const group = new Group() as never;
    // Main view (composer target or canvas), own material: untouched.
    mesh.onBeforeRender(fakeRenderer({ isWebGLRenderTarget: true }), scene, camera, geometry, addBatch.material, group);
    expect(geometry.instanceCount).toBe(drawn);
    mesh.onAfterRender(fakeRenderer(null), scene, camera, geometry, addBatch.material, group);
    expect(geometry.instanceCount).toBe(drawn);
    // Depth-of-field / AO override material: nothing drawn, restored afterwards.
    const depth = new MeshDepthMaterial();
    mesh.onBeforeRender(fakeRenderer(null), scene, camera, geometry, depth, group);
    expect(geometry.instanceCount).toBe(0);
    mesh.onAfterRender(fakeRenderer(null), scene, camera, geometry, depth, group);
    expect(geometry.instanceCount).toBe(drawn);
    // Reflection capture into a cube render target: nothing drawn, restored afterwards.
    mesh.onBeforeRender(fakeRenderer({ isWebGLRenderTarget: true, isWebGLCubeRenderTarget: true }), scene, camera, geometry, addBatch.material, group);
    expect(geometry.instanceCount).toBe(0);
    mesh.onAfterRender(fakeRenderer(null), scene, camera, geometry, addBatch.material, group);
    expect(geometry.instanceCount).toBe(drawn);
    depth.dispose();
    fx.dispose();
  });

  it('extending the call-to-action loop keeps its ring pulses going', () => {
    const fx = makeFx();
    const at = { x: 0, y: 0.25, z: -0.1 };
    fx.burst('cta', at);
    run(fx, 2.4);
    // Same spot again while the loop still runs: it is extended, not doubled.
    fx.burst('cta', at);
    expect(fx.fxState().emitters).toBe(1);
    let rings = 0;
    let prev = fx.familyCounts().ring;
    run(fx, 1.6, () => {
      const now = fx.familyCounts().ring;
      if (now > prev) rings += now - prev;
      prev = now;
    });
    expect(rings).toBeGreaterThanOrEqual(1);
    fx.dispose();
  });
});
