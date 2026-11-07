import type { AgentId } from '#api/agents.ts';
import claude from './logos/claude-code.svg?raw';
import codex from './logos/codex.svg?raw';
import hermes from './logos/hermes-agent.svg?raw';
import omp from './logos/omp.svg?raw';

// Each agent's own mark (sources in the SVG files). Ours, so inlined: the
// one-colour marks draw in the text colour and follow the theme.
const LOGOS: Record<AgentId, string> = { claude, codex, omp, hermes };

// Inlined as markup: the files are the Studio's own.
export function AgentLogo({ id, size = 16 }: { id: AgentId; size?: number }) {
  return <span className="studio-agent-logo" data-agent={id} style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: LOGOS[id] }} />;
}
