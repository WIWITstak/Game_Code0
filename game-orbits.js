// Solar-system orbital mechanics — pure functions, no `this`/state/DOM.
// Used by game-solarsystem3d.js to place planets/moons on their elliptical,
// inclined orbits each frame; Three.js's own camera handles projection to
// screen now, so this module only computes 3D world positions.
'use strict';

const Orbits = {
  INCL_K: 1.5, // exaggerate inclination for readability

  // Position on an elliptical, inclined orbit for eccentric-anomaly-like
  // parameter E (rad). Sun sits at the focus (origin).
  orbitXYZ(view3d, p, E) {
    const a = p.orbit, ecc = p.ecc || 0;
    const b = a * Math.sqrt(1 - ecc * ecc);
    const ox = a * Math.cos(E) - a * ecc;
    const oz = b * Math.sin(E);
    const pr = (p.peri || 0) * Math.PI / 180;
    const cpr = Math.cos(pr), spr = Math.sin(pr);
    let px = ox * cpr - oz * spr;
    let pz = ox * spr + oz * cpr;
    const inc = view3d ? Math.min(0.32, (p.incl || 0) * Math.PI / 180 * Orbits.INCL_K) : 0;
    // clamp absolute out-of-plane height so distant bodies never detach from the disc
    let py = pz * Math.sin(inc);
    const cap = 44;
    if (py > cap) py = cap; else if (py < -cap) py = -cap;
    return { px, py, pz: pz * Math.cos(inc) };
  }
};
