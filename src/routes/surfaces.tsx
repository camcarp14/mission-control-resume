import { Surface, Block, ModelBadge } from '../ui/shell/Surface';
import { Empty, fmt } from '../ui/primitives';
import type { MetricSpec } from '../ui/shell/Metric';

/**
 * Phase 1 surfaces: real page anatomy, real empty states, no data yet.
 *
 * Every empty state names the next action and ships the button — never "No
 * data." The metric row renders with null values (which display as "—") rather
 * than being hidden, so the layout the skeleton resolves into is the layout you
 * get on day one and on day one thousand. Zero layout shift by construction.
 */

const noData = { value: null, offTarget: false };

const CONTROL_METRICS: MetricSpec[] = [
  { label: 'Artifact Vel', format: fmt.one, sub: '/mo · headline', ...noData },
  { label: 'Capex Ratio', format: fmt.pct, sub: 'owned ÷ total', ...noData },
  { label: 'Power Util', format: fmt.pct, sub: 'blocks used', ...noData },
  { label: 'Delegation', format: fmt.ratio, sub: 'agent ÷ human', ...noData },
  { label: 'Moat Index', format: fmt.one, sub: 'model · ordinal', ...noData },
  { label: 'Divergence', format: fmt.months, sub: 'ETA', ...noData },
  { label: 'Runway', format: fmt.months, sub: 'booked only', ...noData },
];

export function Control() {
  return (
    <Surface
      code="CONTROL"
      title="Control plane"
      subtitle="Where capacity went, what it emitted, and what is scheduled next."
      metrics={CONTROL_METRICS}
    >
      <Block title="This week — allocation vs actual">
        <Empty
          title="No capacity ledger for this week yet."
          hint="Log planned hours and power blocks across RENTED / OWNED / TRAINING to start the week. Actuals get filled in as workloads complete."
          action={{ label: 'Open CAPACITY', onClick: () => (location.href = '/capacity') }}
        />
      </Block>
      <Block title="Brownout status" hint="Scheduled load vs available power, 2-week lookahead">
        <Empty
          title="No power budget set."
          hint="Brownout warnings need a daily peak-focus-block budget. Energy is the constraint here, not hours — the app refuses plans that exceed it."
          action={{ label: 'Set power budget', onClick: () => (location.href = '/capacity') }}
        />
      </Block>
      <Block title="Next 3 queued workloads">
        <Empty
          title="Queue is empty."
          hint="Type a rough thing and the scheduler structures it into a workload: fleet, class, capability tags, power cost, artifact yes/no."
          action={{ label: 'Open FLEET', onClick: () => (location.href = '/fleet') }}
        />
      </Block>
    </Surface>
  );
}

export function Capacity() {
  return (
    <Surface
      code="CAPACITY"
      title="Fleet"
      subtitle="Weekly hour and power allocation across RENTED, OWNED and TRAINING. Power is the binding constraint, not hours."
    >
      <Block title="12-week history" hint="Planned vs actual, stacked by fleet">
        <Empty
          title="No weeks logged."
          hint="A single week is enough to draw the first bar. Twelve weeks is enough for the projection engine to stop refusing to extrapolate."
          action={{ label: 'Log this week', onClick: () => {} }}
        />
      </Block>
    </Surface>
  );
}

export function Racks() {
  return (
    <Surface
      code="RACKS"
      title="Capabilities"
      subtitle="Level, decay curve, days since utilized, cohort overlay. Sort by rotting fastest. This screen is supposed to be uncomfortable."
    >
      <Block
        title="Rack inventory"
        hint="Two decay clocks: recall (do you still have it) and currency (is it still true)"
        actions={<ModelBadge>decay = model</ModelBadge>}
      >
        <Empty
          title="No capabilities seeded."
          hint="Seed your taxonomy first — each rack needs a peak level, a retention floor, and two half-lives. Until anchors are set, the 0–100 scale is vibes with decimal places."
          action={{ label: 'Seed taxonomy', onClick: () => {} }}
        />
      </Block>
    </Surface>
  );
}

export function Moat() {
  return (
    <Surface
      code="MOAT"
      title="Combinatorial rarity"
      subtitle="Conditional rarity of the combination, not the sum of the parts. Ranked by marginal moat per hour invested."
    >
      <Block
        title="Next capability, ranked"
        hint="Marginal moat per hour — the difference cancels most of the base-rate error, which is why this ranking is trustworthy even though the absolute score is soft"
        actions={<ModelBadge>ordinal · not a measurement</ModelBadge>}
      >
        <Empty
          title="Needs at least two capabilities and an affinity between them."
          hint="Rarity is computed from pairwise surprisal over an affinity matrix you set and can see — not by multiplying independent probabilities, which would tell you you are one in forty million and be wrong."
          action={{ label: 'Open RACKS', onClick: () => (location.href = '/racks') }}
        />
      </Block>
    </Surface>
  );
}

export function Scaling() {
  return (
    <Surface
      code="SCALING"
      title="Compute-optimal split"
      subtitle="All training, no output. All inference, capability decay and no new racks. Given your decay rates and horizon, solve for the allocation."
    >
      <Block
        title="Loss curve"
        hint="Your current point plotted on it"
        actions={<ModelBadge>model · not a measurement</ModelBadge>}
      >
        <Empty
          title="Needs a horizon and at least one logged week."
          hint="The curve is a model of your situation, not a law of nature. It is honest about that on screen, and it will not draw a point it cannot place."
          action={{ label: 'Set horizon', onClick: () => {} }}
        />
      </Block>
    </Surface>
  );
}

export function Fleet() {
  return (
    <Surface
      code="FLEET"
      title="Workload queue"
      subtitle="Human-hours vs agent-hours per workload. The delegation ratio climbing is the leading indicator of everything else."
    >
      <Block title="Queue">
        <Empty
          title="No workloads."
          hint="Describe a rough thing in plain language; the scheduler returns a structured workload you can edit before saving. Nothing writes to the ledger without your accept."
          action={{ label: 'Add workload', onClick: () => {} }}
        />
      </Block>
      <Block title="Delegation ratio trend" hint="agent-hours ÷ human-hours over time">
        <Empty
          title="No completed workloads yet."
          hint="The ratio needs finished work to be real. Estimates do not count toward it."
          action={{ label: 'Add workload', onClick: () => {} }}
        />
      </Block>
    </Surface>
  );
}

export function Divergence() {
  return (
    <Surface
      code="DIVERGENCE"
      title="Peer trajectory"
      subtitle="Where you separate from the cohort, and when the separation becomes independence. Cohort baselines are an editable model, clearly labelled as one."
    >
      <Block
        title="Trajectory"
        hint="Depth-vs-cohort and breadth-vs-cohort scored separately — comparing your whole capability set to their job title is a rigged fight"
        actions={<ModelBadge>cohort = your inputs</ModelBadge>}
      >
        <Empty
          title="Insufficient data to project."
          hint="A point estimate from three weeks of self-reported capex is not a prediction. This screen stays blank until there is enough ledger history to carry a confidence interval, and it will show you losing on depth when you are."
          action={{ label: 'Edit cohort assumptions', onClick: () => {} }}
        />
      </Block>
      <Block title="Runway to independence" hint="months until booked recurring income ≥ burn">
        <Empty
          title="Runway undefined."
          hint="Runway computes from booked recurring revenue only, never estimates. If booked is $0 today, that is the honest starting state and the app will say so."
          action={{ label: 'Set monthly burn', onClick: () => {} }}
        />
      </Block>
    </Surface>
  );
}

export function Ops() {
  return (
    <Surface
      code="OPS"
      title="Incidents"
      subtitle="Brownouts, missed compounding weeks, production failures, and your forecasting calibration score."
    >
      <Block title="Incidents">
        <Empty
          title="No incidents logged."
          hint="Brownouts get raised automatically when scheduled load exceeds available power two weeks running. Missed compounding weeks get raised when OWNED hours hit zero."
          action={{ label: 'Log incident', onClick: () => {} }}
        />
      </Block>
      <Block
        title="Thesis calibration"
        hint="Brier score over resolved theses — the engine discounts every forward projection by your measured optimism bias"
      >
        <Empty
          title="No resolved theses."
          hint="Record a claim with a confidence and a horizon. When it resolves, the app scores it. Systematically optimistic forecasting makes every projection on every other screen more conservative, automatically."
          action={{ label: 'Record a thesis', onClick: () => {} }}
        />
      </Block>
    </Surface>
  );
}
