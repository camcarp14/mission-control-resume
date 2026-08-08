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
const PAD_BOTTOM = 40;
const MAIN_BLOCK_H = 128; // main line box (textBaseline 'top' at PAD_TOP)
const BAR_GAP = 18; // main line -> underline bar
const BAR_H = 4;
const DIAMOND_GAP = 22; // bar centre -> diamond centre
const DIAMOND_R = 7; // half-diagonal of the rotated square
const SUB_GAP = 44; // bar -> sub-line top
const SUB_BLOCK_H = 40;

const LABEL_OPACITY = 0.92;
const FLOAT_AMP = 0.4;
const FLOAT_FREQ = 0.5;
// Distance fade: full strength through the current leg, gone before two legs
// out. Without it every down-route label stacked into one glowing pile on
// the right edge of the frame (live-site finding, twice — the second pass
// tightened it so ONLY the next station teases).
const FADE_NEAR = 120;
const FADE_FAR = 250;
// Placement, relearned across THREE live rounds of world-offset guessing
// (into the panel; behind the planet; off the frame edge): labels are now
// composed IN THE DOCK FRAME. Each waypoint carries its docked camera
// (camPos/gaze/fov) — the label sits on the ray through a fixed
// upper-left screen point, at ~80% of the body's distance, sized to a
// fixed fraction of the frame. On-screen at every dock by construction.
const LABEL_NDC_X = -0.56; // upper-left quadrant, clear of the panel (right)
const LABEL_NDC_Y = 0.55; // below the top bar
const LABEL_ASPECT = 1.5; // placement basis — a compromise across breakpoints
const LABEL_DEPTH = 0.8; // × distance(dock cam, body)
// Never behind the near face: giants are CLOSE relative to their radius, so
// a fraction of centre-distance can land inside the sphere (Jupiter ate
// half of PIPELINE — live screenshot). The label depth is capped at 92% of
// the distance to the near face.
const LABEL_NEAR_FACE = 0.92;
const LABEL_MIN_DEPTH = 6;
const LABEL_FRACTION = 0.26; // of the frame width at that depth

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
  const spaced = main.split('').join(HAIR_SPACE);

  // Measure first (canvas resize wipes ctx state, so fonts are set twice).
  let mainW = 200;
  let subW = 100;
  if (ctx) {
    ctx.font = MAIN_FONT;
    mainW = ctx.measureText(spaced).width;
    ctx.font = SUB_FONT;
    subW = ctx.measureText(sub).width;
  }

  // Long titles squeeze horizontally instead of overflowing the cap.
  const squeeze = Math.min(1, (CANVAS_MAX_W - PAD_X * 2) / Math.max(1, mainW));
  const innerW = Math.max(mainW * squeeze, subW);
  const w = Math.min(CANVAS_MAX_W, Math.ceil(innerW) + PAD_X * 2);
  const h = PAD_TOP + MAIN_BLOCK_H + BAR_GAP + BAR_H + SUB_GAP + SUB_BLOCK_H + PAD_BOTTOM;
  canvas.width = w;
  canvas.height = h;

  const c = canvas.getContext('2d');
  if (!c) return canvas;
  const cx = w / 2;

  // Backing plate: a soft dark HUD chip behind the type. Against the sun's
  // disc the bare glow text washed out completely ("the title is sort of
  // hard to read there", verbatim) — the plate guarantees contrast on any
  // background while staying quiet over dark sky.
  {
    const padX = 34;
    const padY = 22;
    const plateX = padX;
    const plateY = PAD_TOP - padY;
    const plateW = w - padX * 2;
    const plateH = PAD_TOP + MAIN_BLOCK_H + BAR_GAP + BAR_H + SUB_GAP + SUB_BLOCK_H + padY * 1.5 - plateY;
    const r = 20;
    c.beginPath();
    c.roundRect(plateX, plateY, plateW, plateH, r);
    c.fillStyle = 'rgba(5, 9, 15, 0.52)';
    c.fill();
    c.strokeStyle = 'rgba(154, 220, 255, 0.18)';
    c.lineWidth = 2;
    c.stroke();
  }

  // Main line: two glow passes — a wide soft halo, then a tight hot core.
  c.textAlign = 'center';
  c.textBaseline = 'top';
  c.font = MAIN_FONT;
  c.fillStyle = '#ffffff';
  c.shadowColor = GLOW_COLOR;
  c.save();
  c.translate(cx, PAD_TOP);
  c.scale(squeeze, 1);
  c.shadowBlur = 30;
  c.fillText(spaced, 0, 0);
  c.shadowBlur = 12;
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

  // Sub-line: station code + index in the mono stack.
  c.font = SUB_FONT;
  c.fillStyle = SUB_COLOR;
  c.shadowBlur = 8;
  c.fillText(sub, cx, barY + BAR_H + SUB_GAP);

  return canvas;
}

/* ---- specs -------------------------------------------------------------- */

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
    const main = (station?.id ?? '').replace(/-/g, ' ').toUpperCase();
    if (!main) continue;
    const sub = `${station?.code ?? 'STN'} // ${(wp.index + 1).toString().padStart(2, '0')}`;

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
