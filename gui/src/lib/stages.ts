export type OpportunityStage =
  | 'opp_identification'
  | 'tech_discovery'
  | 'non_pov_tech_validation'
  | 'pov_planning'
  | 'pov_tech_validation'
  | 'tech_decision_pending'
  | 'tech_loss_closed'
  | 'tech_win_closed'
  | 'no_tech_validation_closed';

export interface StageDef {
  id: OpportunityStage;
  label: string;
  shortLabel: string;
  index: number;
  terminal: boolean;
}

export const STAGES: StageDef[] = [
  { id: 'opp_identification',        label: '0 — Opportunity Identification',     shortLabel: 'Opp ID',          index: 0, terminal: false },
  { id: 'tech_discovery',            label: '1 — Tech Discovery',                 shortLabel: 'Discovery',       index: 1, terminal: false },
  { id: 'non_pov_tech_validation',   label: '2 — Non-POV Tech Validation',        shortLabel: 'Non-POV',         index: 2, terminal: false },
  { id: 'pov_planning',              label: '3 — POV Planning',                   shortLabel: 'POV Plan',        index: 3, terminal: false },
  { id: 'pov_tech_validation',       label: '4 — POV Tech Validation',            shortLabel: 'POV Validation',  index: 4, terminal: false },
  { id: 'tech_decision_pending',     label: '5 — Tech Decision Pending',          shortLabel: 'Decision Pending', index: 5, terminal: false },
  { id: 'tech_loss_closed',          label: '6 — Tech Loss — Closed',             shortLabel: 'Tech Loss',       index: 6, terminal: true },
  { id: 'tech_win_closed',           label: '7 — Tech Win — Closed',              shortLabel: 'Tech Win',        index: 7, terminal: true },
  { id: 'no_tech_validation_closed', label: '8 — No Tech Validation — Closed',    shortLabel: 'No Validation',   index: 8, terminal: true },
];

export const STAGE_BY_ID: Record<OpportunityStage, StageDef> =
  STAGES.reduce((acc, s) => ({ ...acc, [s.id]: s }), {} as Record<OpportunityStage, StageDef>);

export function stageLabel(stage: string | null | undefined): string {
  if (!stage) return '—';
  return STAGE_BY_ID[stage as OpportunityStage]?.label || stage;
}

export function stageShort(stage: string | null | undefined): string {
  if (!stage) return '—';
  return STAGE_BY_ID[stage as OpportunityStage]?.shortLabel || stage;
}

export function stageChipClass(stage: string | null | undefined): string {
  switch (stage) {
    case 'tech_win_closed':
      return 'bg-surf-500/20 text-surf-200 border-surf-400';
    case 'tech_loss_closed':
      return 'bg-scarlet-500/20 text-scarlet-200 border-scarlet-400';
    case 'no_tech_validation_closed':
      return 'bg-base-700 text-base-300 border-base-500';
    case 'tech_decision_pending':
      return 'bg-papaya-500/20 text-papaya-200 border-papaya-400';
    case 'pov_tech_validation':
    case 'pov_planning':
    case 'non_pov_tech_validation':
    case 'tech_discovery':
    case 'opp_identification':
      return 'bg-cerulean-500/20 text-cerulean-200 border-cerulean-400';
    default:
      return 'bg-base-800 text-base-300 border-base-500';
  }
}
