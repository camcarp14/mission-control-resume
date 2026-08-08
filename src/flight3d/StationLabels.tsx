/* ==== STATION LABELS =========================================================
 *
 * Big glowing section names floating in the sky beside each planet — the
 * "ABOUT ME written in space" read. Each label is a canvas-drawn HUD plate
 * (main line in display type with a soft cyan glow, a gradient underline, a
 * rotated diamond tick, and a mono sub-line) mounted on a drei Billboard so
 * it always faces the camera. Labels are static world objects derived from
 * the waypoints; the only motion is a gentle float, gated off under reduced.
 *
 * The earthReturn waypoint reuses waypoint 0's Earth, so it gets NO label —
 * a second plate over the same planet would collide with the first.
 * ========================================================================= */

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import type { Waypoint } from '../engine';
import { stations } from '../content/stations.js';

/* ---- tunables ----------------------------------------------------------- */

const MAIN_FONT = '700 120px "Space Grotesk", "Arial", sans-serif';
const SUB_FONT = '500 34px "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';
const GLOW_COLOR = 'rgba(124,200,255,0.9)'; // HUD cyan halo behind the type
const SUB_COLOR = 'rgba(154,220,255,0.85)'; // --hud at panel strength
const HAIR_SPACE = ' '; // simulated letterspacing for the display line
const CANVAS_MAX_W = 1600;
const PAD_X = 56; // side padding — also glow bleed room
const PAD_TOP = 44;
// The bottom padding carries the plate's feathered edge (PLATE_FEATHER) as
// well as the type — at the old 40 that soft edge clipped square against the
// canvas floor, which is exactly the hard black box the plate exists to avoid.
const PAD_BOTTOM = 56;
const MAIN_BLOCK_H = 128; // main line box (textBaseline 'top' at PAD_TOP)
const BAR_GAP = 18; // main line -> underline bar
const BAR_H = 4;
const DIAMOND_GAP = 22; // bar centre -> diamond centre
const DIAMOND_R = 7; // half-diagonal of the rotated square
const SUB_GAP = 44; // bar -> sub-line top
const SUB_BLOCK_H = 40;

/* Legibility over BRIGHT bodies. Reported twice from the live site ("the title
 * is sort of hard to read there as well") and still failing at the sun, where
 * white type with a cyan halo is white on white and the bloom pass eats what
 * little edge is left. Three things fix it together, and none of them alone:
 * a plate opaque enough to be a surface rather than a tint, a FEATHERED edge
 * so that opacity does not read as a black box over deep space, and a dark
 * contour stroked around the glyphs themselves so the type survives even where
 * the plate is at its most transparent. */
const PLATE_TOP = 'rgba(4, 8, 14, 0.94)'; // behind the display line — the worst case
const PLATE_BOTTOM = 'rgba(4, 8, 14, 0.76)'; // eased off under the sub-line, not abandoned
const PLATE_FEATHER = 18; // soft outer falloff, in canvas px
const PLATE_EDGE = 'rgba(154, 220, 255, 0.22)'; // the HUD hairline that names it a chip
const GLYPH_CONTOUR = 'rgba(3, 7, 13, 0.94)';
const MAIN_CONTOUR_W = 15; // stroke is centre-aligned, so ~7px bites into a 120px glyph
const SUB_CONTOUR_W = 5;
// The WIDE halo pass is deliberately weaker than the tight one. At the sun the
// label's own halo clears the bloom threshold, so the post chain re-adds it as
// a haze on top of the plate that was supposed to hold the type — the label
// was washing itself out. The tight core pass keeps the HUD glow; the wide
// pass now only softens the edge.
const HALO_COLOR = 'rgba(124,200,255,0.42)';

// The material's own alpha scales EVERYTHING the canvas painted, plate
// included, so it is the last multiplier standing between the type and the
// sun. Held at 0.92 it capped the plate at 0.86 of what it was authored for,
// which over a bright body is the difference between a surface and a tint.
// There is no cost over deep space: a near-black plate on a near-black sky is
// invisible whatever its alpha — only the hairline and the feather show.
const LABEL_OPACITY = 0.98;
const FLOAT_AMP = 0.4;
const FLOAT_FREQ = 0.5;
// Distance fade: full strength through the current leg, gone before two legs
// out. Without it every down-route label stacked into one glowing pile on
// the right edge of the frame (live-site finding, twice — the second pass
// tightened it so ONLY the next station teases).
const FADE_NEAR = 100;
const FADE_FAR = 190;
// Placement, relearned across THREE live rounds of world-offset guessing
// (into the panel; behind the planet; off the frame edge): labels are now
// composed IN THE DOCK FRAME. Each waypoint carries its docked camera
// (camPos/gaze/fov) — the label sits on the ray through a fixed
// upper-left screen point, at ~80% of the body's distance, sized to a
// fixed fraction of the frame. On-screen at every dock by construction.
const LABEL_NDC_X = -0.62; // upper-left quadrant, clear of the panel (right)
const LABEL_NDC_Y = 0.55; // below the top bar
const LABEL_ASPECT = 1.5; // placement basis — a compromise across breakpoints
const LABEL_DEPTH = 0.8; // × distance(dock cam, body)
// Never behind the near face: giants are CLOSE relative to their radius, so
// a fraction of centre-distance can land inside the sphere (Jupiter ate
// half of PIPELINE — live screenshot). The label depth is capped at 92% of
// the distance to the near face.
const LABEL_NEAR_FACE = 0.92;
const LABEL_MIN_DEPTH = 6;
const LABEL_FRACTION = 0.23; // of the frame width at that depth

/* ---- shared resources --------------------------------------------------- */

const LABEL_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const noRaycast = () => undefined; // labels are decoration; never hit-test
// Scratch camera for dock-frame placement — build-time only, never rendered.
const dockCam = new THREE.PerspectiveCamera(50, LABEL_ASPECT, 0.5, 2600);
const dockCamPos = new THREE.Vector3();
const dockRay = new THREE.Vector3();

/* ---- canvas painting ---------------------------------------------------- */

/** Paint one label plate: glowing display line, gradient underline, rotated
 *  diamond, mono sub-line. Pure draw — fonts must already be loaded. */
function paintLabel(main: string, sub: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  let spaced = main.split('').join(HAIR_SPACE);

  // Measure first (canvas resize wipes ctx state, so fonts are set twice).
  let mainW = 200;
  let subW = 100;
  if (ctx) {
    ctx.font = MAIN_FONT;
    mainW = ctx.measureText(spaced).width;
    // Letterspacing is a look, not a requirement. The longest station name is
    // "CERTS & INSTRUMENTS" at 19 glyphs, and hair-spacing it runs past the
    // canvas cap — answering that with a horizontal squeeze alone would render
    // the one longest label in a visibly condensed face while its neighbours
    // stay wide. Give the tracking up first; squeeze only if still over.
    if (mainW > CANVAS_MAX_W - PAD_X * 2) {
      spaced = main;
      mainW = ctx.measureText(spaced).width;
    }
    ctx.font = SUB_FONT;
    subW = ctx.measureText(sub).width;
  }

  // Anything still past the cap squeezes horizontally rather than overflowing.
  const squeeze = Math.min(1, (CANVAS_MAX_W - PAD_X * 2) / Math.max(1, mainW));
  const innerW = Math.max(mainW * squeeze, subW);
  const w = Math.min(CANVAS_MAX_W, Math.ceil(innerW) + PAD_X * 2);
  const h = PAD_TOP + MAIN_BLOCK_H + BAR_GAP + BAR_H + SUB_GAP + SUB_BLOCK_H + PAD_BOTTOM;
  canvas.width = w;
  canvas.height = h;

  const c = canvas.getContext('2d');
  if (!c) return canvas;
  const cx = w / 2;

  // Backing plate: a dark HUD chip behind the type, top-heavy and feathered.
  // The gradient puts the weight where the display line is and eases off under
  // the sub-line, and the shadow pass blurs the chip's own edge outward — which
  // is what lets it be nearly opaque and still read as a scrim rather than a
  // slab. The previous flat 0.52 fill was invisible against Saturn, the sun and
  // Jupiter, which is exactly where the complaint keeps coming from.
  {
    const padX = 34;
    const padY = 22;
    const plateX = padX;
    const plateY = PAD_TOP - padY;
    const plateW = w - padX * 2;
    const plateH = PAD_TOP + MAIN_BLOCK_H + BAR_GAP + BAR_H + SUB_GAP + SUB_BLOCK_H + padY * 1.5 - plateY;
    const r = 20;
    const scrim = c.createLinearGradient(0, plateY, 0, plateY + plateH);
    scrim.addColorStop(0, PLATE_TOP);
    scrim.addColorStop(0.58, PLATE_TOP);
    scrim.addColorStop(1, PLATE_BOTTOM);
    c.save();
    c.beginPath();
    c.roundRect(plateX, plateY, plateW, plateH, r);
    c.shadowColor = 'rgba(2, 4, 8, 0.72)';
    c.shadowBlur = PLATE_FEATHER;
    c.fillStyle = scrim;
    c.fill();
    c.restore();
    c.beginPath();
    c.roundRect(plateX, plateY, plateW, plateH, r);
    c.strokeStyle = PLATE_EDGE;
    c.lineWidth = 2;
    c.stroke();
  }

  // Main line, three passes, and the ORDER is the fix. Wide cyan halo first,
  // then a dark contour stroked around the glyphs, then the hot white core on
  // top. Over deep space the halo is what you see; over the sun's disc the
  // contour is a hard dark edge that neither the bright body nor the bloom
  // pass can eat, because it does not depend on the plate underneath it.
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.font = MAIN_FONT;
  c.lineJoin = 'round';
  c.miterLimit = 2;
  c.save();
  c.translate(cx, PAD_TOP);
  c.scale(squeeze, 1);
  c.fillStyle = '#ffffff';
  c.shadowColor = HALO_COLOR;
  c.shadowBlur = 26;
  c.fillText(spaced, 0, 0);
  c.strokeStyle = GLYPH_CONTOUR;
  c.lineWidth = MAIN_CONTOUR_W;
  c.shadowColor = 'rgba(2, 4, 8, 0.92)';
  c.shadowBlur = 12;
  c.strokeText(spaced, 0, 0);
  c.shadowColor = GLOW_COLOR;
  c.shadowBlur = 10;
  c.fillText(spaced, 0, 0);
  c.restore();

  // Underline bar: thin symmetric cyan gradient fading out at both ends.
  const barY = PAD_TOP + MAIN_BLOCK_H + BAR_GAP;
  const barW = Math.max(mainW * squeeze * 0.92, subW);
  const grad = c.createLinearGradient(cx - barW / 2, 0, cx + barW / 2, 0);
  grad.addColorStop(0, 'rgba(125,249,255,0)');
  grad.addColorStop(0.5, 'rgba(125,249,255,0.85)');
  grad.addColorStop(1, 'rgba(125,249,255,0)');
  c.shadowBlur = 8;
  c.fillStyle = grad;
  c.fillRect(cx - barW / 2, barY, barW, BAR_H);

  // Diamond tick between the bar and the sub-line.
  c.save();
  c.translate(cx, barY + BAR_H + DIAMOND_GAP);
  c.rotate(Math.PI / 4);
  c.fillStyle = 'rgba(154,220,255,0.9)';
  c.fillRect(-DIAMOND_R, -DIAMOND_R, DIAMOND_R * 2, DIAMOND_R * 2);
  c.restore();

  // Sub-line: station code and how far into the mission it sits. Contoured
  // like the display line — at 34px over Saturn's pale disc the mono stack
  // was the first thing to disappear.
  const subY = barY + BAR_H + SUB_GAP;
  c.font = SUB_FONT;
  c.shadowColor = 'rgba(2, 4, 8, 0.9)';
  c.shadowBlur = 6;
  c.strokeStyle = GLYPH_CONTOUR;
  c.lineWidth = SUB_CONTOUR_W;
  c.strokeText(sub, cx, subY);
  c.fillStyle = SUB_COLOR;
  c.shadowColor = GLOW_COLOR;
  c.shadowBlur = 8;
  c.fillText(sub, cx, subY);

  return canvas;
}

/* ---- specs -------------------------------------------------------------- */

/**
 * Signage text for one station. This is the largest piece of type anywhere in
 * the product, so it has to be the station's NAME. Deriving it from the
 * machine id printed "CERTS INSTRUMENTS" across the sun — the ampersand was
 * never in `certs-instruments` to begin with — and rendered everything else as
 * a de-hyphenated slug rather than the title on the panel beside it.
 *
 * Titles are "Head — Subtitle": the head is the signage, the subtitle is panel
 * copy and has no business at 120px. Splitting on the em dash leaves the head
 * with a trailing space, and titles that carry an ampersand already have
 * spaces around it, so the run collapse is what keeps a stray double space out
 * of a line that is about to be letterspaced glyph by glyph.
 */
function signage(title: string): string {
  const head = title.split(/\s*[—–]\s*/)[0] ?? title;
  return head.replace(/\s+/g, ' ').trim().toUpperCase();
}

type LabelSpec = {
  index: number;
  texture: THREE.CanvasTexture;
  /** canvas height / width — sizes the plane without distortion */
  aspect: number;
  position: [number, number, number];
  width: number;
};

function buildSpecs(waypoints: Waypoint[]): LabelSpec[] {
  const specs: LabelSpec[] = [];
  for (const wp of waypoints) {
    // The homecoming reuses waypoint 0's Earth — a second label would collide.
    if (wp.kind === 'earthReturn') continue;
    // Station 0 belongs to the DOM hero overlay (the pilot's name in display
    // type over this exact frame) — a scene label there printed the section
    // name straight through the headline (screenshot finding).
    if (wp.index === 0) continue;
    const station = stations[wp.index];
    const main = signage(station?.title ?? '');
    if (!main) continue;
    // The code already ENDS in the station number, so pairing it with the same
    // number printed the count twice ("STN 09 // 9"). The second half now says
    // something the first half does not: how many stations there are, so the
    // line reads as a position in the mission rather than a stutter.
    const sub = `${station?.code ?? 'STN'} // ${stations.length.toString().padStart(2, '0')}`;

    const canvas = paintLabel(main, sub);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;

    // Above the body, shifted toward the flight line so it sits between the
    // planet and the camera path — never behind the planet. Field kinds have
    // no crisp limb, so their label rides higher to clear the haze.
    // Dock-frame placement: rebuild this waypoint's docked camera, cast a
    // ray through the fixed upper-left screen point, park the label at 80%
    // of the body's distance, and size it to a fixed screen fraction.
    dockCam.fov = wp.fov;
    dockCam.aspect = LABEL_ASPECT;
    dockCamPos.set(wp.camPos[0], wp.camPos[1], wp.camPos[2]);
    dockCam.position.copy(dockCamPos);
    dockCam.up.set(0, 1, 0);
    dockCam.lookAt(wp.gaze[0], wp.gaze[1], wp.gaze[2]);
    dockCam.updateMatrixWorld(true);
    dockCam.updateProjectionMatrix();
    const bodyDist = Math.hypot(
      wp.bodyPos[0] - wp.camPos[0],
      wp.bodyPos[1] - wp.camPos[1],
      wp.bodyPos[2] - wp.camPos[2],
    );
    const depth = Math.max(
      LABEL_MIN_DEPTH,
      Math.min(bodyDist * LABEL_DEPTH, (bodyDist - wp.bodyRadius) * LABEL_NEAR_FACE),
    );
    dockRay.set(LABEL_NDC_X, LABEL_NDC_Y, 0.5).unproject(dockCam).sub(dockCamPos).normalize();
    const width =
      2 * depth * Math.tan(THREE.MathUtils.degToRad(wp.fov) / 2) * LABEL_ASPECT * LABEL_FRACTION;
    specs.push({
      index: wp.index,
      texture,
      aspect: canvas.height / Math.max(1, canvas.width),
      position: [
        dockCamPos.x + dockRay.x * depth,
        dockCamPos.y + dockRay.y * depth,
        dockCamPos.z + dockRay.z * depth,
      ],
      width,
    });
  }
  return specs;
}

/* ---- one floating plate -------------------------------------------------- */

const tmpLabelPos = new THREE.Vector3();

function FloatingLabel({ spec, reduced }: { spec: LabelSpec; reduced: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((state) => {
    // Distance fade is STATE (where the camera is), not motion — it runs on
    // every rung, including reduced's demand-rendered snap frames.
    const m = matRef.current;
    if (m) {
      const d = state.camera.position.distanceTo(
        tmpLabelPos.set(spec.position[0], spec.position[1], spec.position[2]),
      );
      const k = Math.min(1, Math.max(0, (d - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
      m.opacity = LABEL_OPACITY * (1 - k * k * (3 - 2 * k));
    }
    if (reduced) return; // the float below is motion — sacred-off
    const g = groupRef.current;
    if (!g) return;
    g.position.y =
      spec.position[1] +
      Math.sin(state.clock.elapsedTime * FLOAT_FREQ + spec.index) * FLOAT_AMP;
  });

  return (
    <group ref={groupRef} position={spec.position}>
      <Billboard>
        <mesh
          geometry={LABEL_GEOMETRY}
          scale={[spec.width, spec.width * spec.aspect, 1]}
          raycast={noRaycast}
        >
          <meshBasicMaterial
            ref={matRef}
            map={spec.texture}
            transparent
            opacity={LABEL_OPACITY}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
    </group>
  );
}

/* ---- public surface ------------------------------------------------------ */

export function StationLabels({
  waypoints,
  reduced,
}: {
  waypoints: Waypoint[];
  reduced: boolean;
}) {
  const [specs, setSpecs] = useState<LabelSpec[]>([]);

  // Wait for the vendored display face before painting — a canvas drawn with
  // the fallback font would bake the wrong letterforms into the texture
  // forever. One late frame is invisible; a wrong font is not.
  useEffect(() => {
    let alive = true;
    document.fonts
      .load('700 120px "Space Grotesk"')
      .catch(() => {})
      .then(() => {
        if (!alive) return;
        setSpecs(buildSpecs(waypoints));
      });
    return () => {
      alive = false;
    };
  }, [waypoints]);

  // Textures live in state; whichever set is current gets disposed when it is
  // replaced (waypoints change) or on unmount.
  useEffect(
    () => () => {
      for (const s of specs) s.texture.dispose();
    },
    [specs],
  );

  return (
    <group>
      {specs.map((spec) => (
        <FloatingLabel key={spec.index} spec={spec} reduced={reduced} />
      ))}
    </group>
  );
}
