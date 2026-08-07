import { m } from 'framer-motion';
import type { MotionValue } from 'framer-motion';

/**
 * The ship. Hand-built SVG — crisp at any DPR, and every part that moves is
 * its own node: the whole craft rotates toward the path tangent, the local
 * "kick" spring gives it mass on departure/arrival, and the exhaust runs two
 * animations at once (a CSS flare burst keyed per departure, and a sustained
 * scaleX bound to the camera's velocity). The accent colour appears exactly
 * once in the whole stage: it is the thrust.
 */
export function Rocket({
  anchor,
  size,
  rotate,
  kickX,
  kickY,
  flameScaleX,
  flameOpacity,
  flareKey,
  reduced,
}: {
  anchor: { left: string; top: string };
  size: number;
  rotate: MotionValue<number>;
  kickX: MotionValue<number>;
  kickY: MotionValue<number>;
  flameScaleX: MotionValue<number>;
  flameOpacity: MotionValue<number>;
  flareKey: number;
  reduced: boolean;
}) {
  const flameOrigin = { transformBox: 'fill-box', transformOrigin: 'right center' } as const;
  return (
    <div className="rocketwrap" style={{ left: anchor.left, top: anchor.top }} aria-hidden="true">
      <m.div style={{ x: kickX, y: kickY, rotate }}>
        <div className={reduced ? undefined : 'bob'}>
          <svg
            width={size}
            height={(size * 40) / 96}
            viewBox="0 0 96 40"
            fill="none"
            style={{ display: 'block', marginLeft: '-50%', marginTop: '-21%' }}
          >
            {/* exhaust — flare bursts on departure (CSS, keyed), sustained
                plume tracks camera velocity (Framer) */}
            {reduced ? (
              <g style={flameOrigin} opacity={0.7}>
                <path d="M24 20 Q13 15 6 20 Q13 25 24 20 Z" fill="#ff5c37" opacity="0.75" />
                <path d="M24 20 Q16 17.5 11 20 Q16 22.5 24 20 Z" fill="#ffb59e" opacity="0.9" />
              </g>
            ) : (
              <g key={flareKey} className="flare" style={flameOrigin}>
                <m.g style={{ ...flameOrigin, scaleX: flameScaleX, opacity: flameOpacity }}>
                  <path d="M24 20 Q10 14 2 20 Q10 26 24 20 Z" fill="#ff5c37" opacity="0.75" />
                  <path d="M24 20 Q14 16.5 8 20 Q14 23.5 24 20 Z" fill="#ffb59e" opacity="0.9" />
                </m.g>
              </g>
            )}

            {/* nozzle */}
            <path d="M28 15 L24 16.5 L24 23.5 L28 25 Z" fill="#1a1e24" stroke="rgba(255,255,255,0.28)" strokeWidth="1" />

            {/* fins */}
            <path d="M31 13 L21 4 L40 12.5 Z" fill="#0d0f13" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinejoin="round" />
            <path d="M31 27 L21 36 L40 27.5 Z" fill="#0d0f13" stroke="rgba(255,255,255,0.3)" strokeWidth="1" strokeLinejoin="round" />

            {/* fuselage */}
            <path
              d="M28 12.5 L62 12.5 Q83 13 92 20 Q83 27 62 27.5 L28 27.5 Q30.5 20 28 12.5 Z"
              fill="#12151a"
              stroke="rgba(255,255,255,0.38)"
              strokeWidth="1"
              strokeLinejoin="round"
            />
            {/* panel seams — the telemetry read */}
            <path d="M40 13 Q42 20 40 27" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
            <path d="M56 12.7 Q58 20 56 27.3" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />

            {/* porthole */}
            <circle cx="70" cy="20" r="4.4" fill="#08090b" stroke="rgba(255,255,255,0.4)" strokeWidth="1" />
            <circle cx="71.4" cy="18.7" r="1.1" fill="rgba(255,255,255,0.35)" />
          </svg>
        </div>
      </m.div>
    </div>
  );
}
