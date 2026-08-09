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

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import type { Waypoint } from '../engine';
import { MOBILE_BREAKPOINT } from '../engine';
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

/* ---- the phone ----------------------------------------------------------
 *
 * PORTRAIT BROKE THE DOCK-FRAME TRICK, and it broke it twice. The placement
 * above composes every plate against a FIXED 1.5 frame — the desktop shape it
 * was tuned in — and then trusts that one ray at every breakpoint. On a phone
 * neither half of that survives: the frame is about 0.6 wide-to-tall, so NDC
 * -0.62 sits far closer to the physical edge than it does at 1.5, and the
 * plate is sized to a fraction of a frame that is now much narrower. Scene3D
 * also widens the docked fov by nine degrees on mobile, which moves it again.
 * Both of the owner's phone screenshots are that arithmetic: one plate cut at
 * x=0 with a sliver of a glyph showing through the panel's left gutter, one
 * cut at the right edge. Measured at 390x660 the plate spans x = -160..47 of
 * a 390 frame — four fifths of it off screen, at EVERY station.
 *
 * So mobile does not re-tune the constants. It composes in the LIVE frame and
 * clamps the plate's projected box against that frame's edges: a clamp cannot
 * clip by construction, at any fov, aspect or plate width, where a tuned
 * number is only ever right for the widths that happened to get tested.
 *
 * WHERE A PLATE CAN LIVE AT ALL on a phone is the second half of the answer,
 * and it is a much smaller place than it looks. Measured at all eleven
 * stations at 360x640, 390x660 and 430x700 — Safari with its toolbars up,
 * which is the only height worth testing, since emulating the spec 844/932
 * hides every one of these bugs — the DOM station card cannot floor lower
 * than its wrapper's bottom padding (112px) and the rail bar's roof is 62px
 * up, while the card's TOP reaches 69 at the tallest stations and the top bar
 * already owns down to 62. The sky above the card is therefore seven pixels
 * at worst: there is no "above it" to place a label in. The one band that is
 * free at every station and every width is the 50px strip between the card's
 * floor and the rail. The mobile plate is a nameplate in that strip —
 * centred, sized by HEIGHT so the type lands the same size at every station
 * (the desktop plate is sized by width, which is why its type runs 27px at
 * the longest name and 65px at the shortest — a spread a 36px slot cannot
 * afford), never behind the card, never touching a frame edge.
 * ------------------------------------------------------------------------- */

/** Degrees of extra field of view the docked camera takes on a phone.
 *
 *  A label placed against the wrong fov lands in the wrong place, so this
 *  number has to be the SAME number the rig flies with — it was briefly a
 *  copy of it, which is a silent-drift bug waiting for whoever tunes the
 *  mobile framing next and edits one of the two. It lives here rather than in
 *  Scene3D because Scene3D already imports this module, and the reverse would
 *  close a cycle. */
export const MOBILE_FOV_BONUS = 9;
// The strip is MEASURED, never assumed. Its two edges are the station card's
// floor (the panel wrapper's bottom padding — the card can grow to it and no
// further) and the rail bar's roof, both of which live in polish.css, change
// by breakpoint, and are being tuned independently of this file. Duplicating
// either number here would leave the plate parked over a card the stylesheet
// had since moved; the same reasoning already makes Scene3D measure the
// telemetry column rather than restate its width. These two are only the
// floor if neither element can be found at all (static mode, a rename).
const MOBILE_RAIL_H = 62;
const MOBILE_CARD_PAD = 112;
// Air between the plate and each edge of the strip, and it is spent twice
// over: once so the card's rounded bottom edge stays visibly separate, and
// once on the docked camera's breathing, which was sampled at four stations
// over sixteen seconds and moves the plate ±6px vertically. Seven is what is
// left of a 50px strip once a plate worth reading is in it — the plate rides
// out its cycle a pixel inside both edges, and the pixel it would ever spend
// is its own top padding, never a glyph.
const MOBILE_SLOT_GAP = 7;
// Plate height in CSS px: as tall as the strip allows, capped so a roomier
// strip cannot turn the nameplate into a billboard, floored so a tighter one
// cannot shrink it away entirely (at which point it would be better hidden,
// and the frame clamp still guarantees it is whole).
const MOBILE_SLOT_MAX_H = 40;
const MOBILE_SLOT_MIN_H = 22;
// Air kept between the plate and the left/right frame edges, on top of the
// breathing allowance below.
const MOBILE_SIDE_INSET = 14;
// The dock frame is NOT static: the rig breathes the camera by ±0.5 world
// units and swings the gaze with it, so the frame the placement was solved
// for is never quite the frame on screen. One world unit of allowance is
// ~15px at label depth, comfortably over the ±6px measured, and it is what
// keeps "inside the frame" true at both ends of the cycle rather than only at
// the pose the arithmetic used.
const DOCK_BREATH = 1;
// A plate the frame is about to cut is not shown: opacity ramps to zero as
// its box comes within this fraction of the frame's width of an edge. The
// docked plate never sees it — the clamp parks it a hundred-odd pixels clear
// — but a NEIGHBOUR's plate, composed for a dock you are not standing at, can
// drift onto an edge at any time, and that is the second screenshot the owner
// sent. Fading is right where hiding is not: what is whole stays, what would
// be cut leaves, and the change reads as depth rather than a pop.
const EDGE_BAND = 0.05;

/* ---- shared resources --------------------------------------------------- */

const LABEL_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const noRaycast = () => undefined; // labels are decoration; never hit-test
// Scratch camera for dock-frame placement — build-time only, never rendered.
const dockCam = new THREE.PerspectiveCamera(50, LABEL_ASPECT, 0.5, 2600);
const dockCamPos = new THREE.Vector3();
const dockRay = new THREE.Vector3();
const dockRight = new THREE.Vector3();
const dockUp = new THREE.Vector3();
const dockFwd = new THREE.Vector3();
const dockPos = new THREE.Vector3();

/* ---- canvas painting ---------------------------------------------------- */

/** Paint one label plate: glowing display line, gradient underline, rotated
 *  diamond, mono sub-line. Pure draw — fonts must already be loaded.
 *
 *  `compact` drops the diamond and the sub-line, and that is a phone-only
 *  composition for one reason: the slot the mobile plate has to live in is 36
 *  screen pixels tall, and at that height the 34px mono line renders under
 *  four pixels high — a grey smudge, which is exactly the "shrunk into noise"
 *  failure. Removing it takes 84px off a 334px canvas, so the same 36px slot
 *  now buys a display line a third larger (120px type landing at 17 screen px
 *  rather than 13), and it costs the visitor nothing: the sub-line says
 *  "STN 05 // 11", and the DOM panel is printing STN 05 in mono a hundred
 *  pixels above it. */
function paintLabel(main: string, sub: string, compact = false): HTMLCanvasElement {
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
  // Everything below measures from the bottom of the drawn content, so the
  // compact plate is the same composition with its last two rows removed —
  // the plate rect, the canvas and the feather all follow it down.
  const contentH = PAD_TOP + MAIN_BLOCK_H + BAR_GAP + BAR_H + (compact ? 0 : SUB_GAP + SUB_BLOCK_H);
  const h = contentH + PAD_BOTTOM;
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
    const plateH = contentH + padY * 1.5 - plateY;
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

  // The bar is the compact plate's last row: below it there is nothing left
  // that would survive being drawn a fifth of the size it was authored at.
  if (compact) return canvas;

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

/** One painted plate. Textures are expensive (nine canvases, up to 1600px
 *  wide) and depend only on the text, so they are built once and outlive every
 *  reflow — placement is the cheap half and is redone against the live
 *  frame. Before the split, teaching placement about the viewport would have
 *  repainted all nine on every Safari toolbar collapse. */
type Plate = {
  index: number;
  texture: THREE.CanvasTexture;
  /** canvas height / width — sizes the plane without distortion */
  aspect: number;
};

type LabelSpec = Plate & {
  position: [number, number, number];
  width: number;
};

/** The frame the plates are composed in. Read from the canvas rather than the
 *  window so it is the surface actually being rendered to. */
type Frame = {
  w: number;
  h: number;
  mobile: boolean;
  /** The free strip, in CSS px from the top of the frame: the station card
   *  can reach down to `slotTop`, the rail bar starts at `slotBottom`. */
  slotTop: number;
  slotBottom: number;
};

function paintPlates(waypoints: Waypoint[], compact: boolean): Plate[] {
  const plates: Plate[] = [];
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

    const canvas = paintLabel(main, sub, compact);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    plates.push({
      index: wp.index,
      texture,
      aspect: canvas.height / Math.max(1, canvas.width),
    });
  }
  return plates;
}

function placeSpecs(waypoints: Waypoint[], plates: Plate[], frame: Frame): LabelSpec[] {
  const specs: LabelSpec[] = [];
  for (const plate of plates) {
    // voyage() indexes its waypoints by position, and the plates were painted
    // from this same array.
    const wp = waypoints[plate.index];
    if (!wp) continue;

    // Dock-frame placement: rebuild this waypoint's docked camera and park
    // the label at ~80% of the body's distance, in front of its near face.
    // Both breakpoints share that much; where they part is the screen point
    // the plate is composed at, and against which frame shape.
    dockCam.fov = frame.mobile ? wp.fov + MOBILE_FOV_BONUS : wp.fov;
    dockCam.aspect = frame.mobile ? frame.w / frame.h : LABEL_ASPECT;
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

    if (!frame.mobile) {
      // Above the body, shifted toward the flight line so it sits between the
      // planet and the camera path — never behind the planet. Cast a ray
      // through the fixed upper-left screen point and size the plate to a
      // fixed fraction of the (fixed 1.5) frame.
      dockRay.set(LABEL_NDC_X, LABEL_NDC_Y, 0.5).unproject(dockCam).sub(dockCamPos).normalize();
      const width =
        2 * depth * Math.tan(THREE.MathUtils.degToRad(wp.fov) / 2) * LABEL_ASPECT * LABEL_FRACTION;
      specs.push({
        ...plate,
        position: [
          dockCamPos.x + dockRay.x * depth,
          dockCamPos.y + dockRay.y * depth,
          dockCamPos.z + dockRay.z * depth,
        ],
        width,
      });
      continue;
    }

    // ---- the phone, composed in the frame it will actually be seen in -----
    // Everything here is solved in the dock camera's own space rather than in
    // NDC, because the plate is billboarded: its plane is parallel to the
    // image plane, so its four corners are the centre ± half a width and half
    // a height at ONE view depth, and "is the box inside the frame" is then a
    // comparison of two numbers rather than four projections.
    const tanH = Math.tan(THREE.MathUtils.degToRad(wp.fov + MOBILE_FOV_BONUS) / 2);
    const aspect = frame.w / frame.h;
    const slotH = Math.max(
      MOBILE_SLOT_MIN_H,
      Math.min(MOBILE_SLOT_MAX_H, frame.slotBottom - frame.slotTop - MOBILE_SLOT_GAP * 2),
    );
    const ndcX = 0; // centred: on a phone no panel owns a side of the frame
    // The strip's midpoint, in NDC. The halving of (top + bottom) and the
    // doubling that px -> NDC needs cancel, which is why neither appears.
    const ndcY = 1 - (frame.slotTop + frame.slotBottom) / frame.h;
    // The view depth is fixed HERE, from the ray the plate would have ridden,
    // and never touched again — which is what makes the clamps below exact in
    // one pass. It also keeps the near-face cap honest: clamping only pulls
    // the centre toward the view axis, and that can only shorten the distance
    // from the camera, never push the plate into the planet.
    const z = depth / Math.hypot(1, ndcX * tanH * aspect, ndcY * tanH);
    const halfY = z * tanH;
    const halfX = halfY * aspect;
    const perPx = (2 * halfY) / frame.h; // world units per CSS pixel, both axes
    const room = MOBILE_SIDE_INSET * perPx + DOCK_BREATH;
    // Sized by HEIGHT, then capped against both frame axes: whichever of the
    // three wins, the box cannot be bigger than the frame it has to sit in.
    const halfW = Math.min(
      (slotH * perPx) / plate.aspect / 2,
      halfX - room,
      (halfY - room) / plate.aspect,
    );
    const halfH = halfW * plate.aspect;
    const cx = THREE.MathUtils.clamp(ndcX * halfX, -(halfX - halfW - room), halfX - halfW - room);
    const cy = THREE.MathUtils.clamp(ndcY * halfY, -(halfY - halfH - room), halfY - halfH - room);
    dockRight.setFromMatrixColumn(dockCam.matrixWorld, 0);
    dockUp.setFromMatrixColumn(dockCam.matrixWorld, 1);
    dockFwd.setFromMatrixColumn(dockCam.matrixWorld, 2).negate();
    dockPos
      .copy(dockCamPos)
      .addScaledVector(dockRight, cx)
      .addScaledVector(dockUp, cy)
      .addScaledVector(dockFwd, z);
    specs.push({
      ...plate,
      position: [dockPos.x, dockPos.y, dockPos.z],
      width: halfW * 2,
    });
  }
  return specs;
}

/* ---- one floating plate -------------------------------------------------- */

const tmpLabelPos = new THREE.Vector3();
const tmpLabelView = new THREE.Vector3();

/**
 * How much of the frame's edge the plate still has to spare, as a 0..1 fade —
 * 1 well inside, 0 the moment any corner reaches an edge. Billboards are
 * parallel to the image plane, so the box IS the centre ± half a width and
 * half a height at one view depth, and the whole test is two subtractions.
 *
 * Mobile only, and it is the half of the fix that placement cannot do: a
 * plate is composed for its OWN dock, and from the dock next door it can sit
 * anywhere at all — including straddling the right edge, which is the second
 * screenshot the owner sent. Placement guarantees the plate you are docked at;
 * this guarantees every other one in the frame.
 */
function edgeFade(cam: THREE.PerspectiveCamera, pos: THREE.Vector3, spec: LabelSpec): number {
  tmpLabelView.copy(pos).applyMatrix4(cam.matrixWorldInverse);
  const z = -tmpLabelView.z;
  if (z <= 0) return 0; // behind the lens
  const halfY = z * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
  const halfX = halfY * cam.aspect;
  const halfW = spec.width / 2;
  const slack = Math.min(
    halfX - (Math.abs(tmpLabelView.x) + halfW),
    halfY - (Math.abs(tmpLabelView.y) + halfW * spec.aspect),
  );
  const k = Math.min(1, Math.max(0, slack / (halfX * 2 * EDGE_BAND)));
  return k * k * (3 - 2 * k);
}

function FloatingLabel({
  spec,
  reduced,
  mobile,
}: {
  spec: LabelSpec;
  reduced: boolean;
  mobile: boolean;
}) {
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
      // The plate does not float on mobile, so its static position IS where
      // the box is — no need to read the group back.
      if (mobile) {
        m.opacity *= edgeFade(state.camera as THREE.PerspectiveCamera, tmpLabelPos, spec);
      }
    }
    // The float is motion — sacred-off under reduced — and it is off on the
    // phone too, for a reason that has nothing to do with motion preference:
    // 0.4 world units is ±6px at label depth, and on top of the ±6px the rig's
    // own breathing already spends, a 36px plate in a 50px strip would ride
    // out of it and slide behind the card. Desktop has nine hundred pixels of
    // frame to float in and keeps it.
    if (reduced || mobile) return;
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
  // The canvas' own size, not the window's: this is the surface being drawn
  // to, and it is what R3F re-reports when Safari's toolbars come and go.
  // Scene3D derives its `mobile` from the same viewport width but does not
  // pass it down — plumbing it through is the tidier fix and belongs to that
  // file, so the breakpoint is read locally here rather than guessed at.
  const size = useThree((s) => s.size);
  const mobile = size.width < MOBILE_BREAKPOINT;
  const [plates, setPlates] = useState<Plate[]>([]);
  const [slot, setSlot] = useState<{ top: number; bottom: number } | null>(null);

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
        setPlates(paintPlates(waypoints, mobile));
      });
    return () => {
      alive = false;
    };
  }, [waypoints, mobile]);

  // Both edges of the strip belong to elements that are SIBLINGS of the
  // canvas, so neither is in the document while this component renders —
  // measuring after the commit is the only reading that can be trusted, and
  // re-measuring on resize is what keeps it true when Safari's toolbars come
  // and go. The card's floor is read as the wrapper's bottom padding rather
  // than any mounted panel's box: panels are per-station and their heights
  // differ by 90px, while the padding is the one line that says how far down
  // the tallest of them may ever reach.
  useEffect(() => {
    if (!mobile) return; // desktop composes in open sky; there is no strip to fit
    const bar = document.querySelector('.hudbar')?.getBoundingClientRect();
    const bottom = bar && bar.height > 0 ? bar.top : size.height - MOBILE_RAIL_H;
    const wrap = document.querySelector('.panelwrap');
    const pad = wrap ? Number.parseFloat(getComputedStyle(wrap).paddingBottom) : Number.NaN;
    setSlot({
      top: size.height - (Number.isFinite(pad) && pad > 0 ? pad : MOBILE_CARD_PAD),
      bottom,
    });
  }, [size.width, size.height, mobile]);

  // Placement is pure arithmetic over the plates — recomposing the phone's
  // frame costs nothing and touches no texture.
  const specs = useMemo(
    () =>
      placeSpecs(waypoints, plates, {
        w: size.width,
        h: size.height,
        mobile,
        slotTop: slot ? slot.top : size.height - MOBILE_CARD_PAD,
        slotBottom: slot ? slot.bottom : size.height - MOBILE_RAIL_H,
      }),
    [waypoints, plates, size.width, size.height, mobile, slot],
  );

  // Textures live in state; whichever set is current gets disposed when it is
  // replaced (waypoints change, or the breakpoint changes the composition) or
  // on unmount. Placement never replaces them.
  useEffect(
    () => () => {
      for (const p of plates) p.texture.dispose();
    },
    [plates],
  );

  return (
    <group>
      {specs.map((spec) => (
        <FloatingLabel key={spec.index} spec={spec} reduced={reduced} mobile={mobile} />
      ))}
    </group>
  );
}
