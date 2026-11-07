import type { ComponentRenderProps } from '@fumadocs-editor/ui';
import { renderDiagramSvg } from '@fdbook/diagram/render.ts';
import { diagramPathOf } from '@fdbook/diagram/source.ts';
import { validateDiagram, type DiagramIssue } from '@fdbook/diagram/validate.ts';
import { Workflow } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAssetUrl } from '#api/asset-versions.ts';
import { errorOf, readJson } from '#api/json.ts';
import { studioFetch } from '#api/session.ts';
import type { TextFile } from '#api/files.ts';
import '@fdbook/diagram/styles/diagram.css';
import './diagram.css';
import { DIAGRAM_SUFFIX, DIAGRAMS_DIR } from '@fdbook/shared/asset-types.ts';

type Drawn = { svg: string | null; issues: DiagramIssue[] } | { failed: string };

// The diagram file `src` names, read through the file API and drawn with
// the site's renderer. Its URL carries the file's version once it changed on
// disk (App's file events), so a save from an agent or the CLI redraws it.
function useDiagram(src: string | undefined): Drawn | null {
  const path = src ? diagramPathOf(src, DIAGRAMS_DIR) : null;
  const url = useAssetUrl(path ?? '');
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  useEffect(() => {
    if (!path) return;
    let current = true;
    studioFetch(url)
      .then(async (response) => {
        if (!response.ok) throw await errorOf(response);
        const { content } = await readJson<TextFile>(response);
        const { scene, issues } = validateDiagram(JSON.parse(content));
        return { svg: scene ? renderDiagramSvg(scene, `studio-${path}`) : null, issues };
      })
      .then(
        (next) => { if (current) setDrawn(next); },
        (error: unknown) => { if (current) setDrawn({ failed: (error as Error).message }); },
      );
    return () => { current = false; };
  }, [path, url]);
  return path ? drawn : null;
}

const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`;

// <Diagram> drawn as the note shows it, without the viewer's hover and
// notes; the caption region renders in `children`. Problems the checks find
// are counted in the bar, the first error named when it does not draw.
export function Diagram({ props, children }: ComponentRenderProps) {
  const drawn = useDiagram(props.src);
  const issues = drawn && 'issues' in drawn ? drawn.issues : [];
  const errors = issues.filter((issue) => issue.severity === 'error');
  return (
    <figure className="studio-card studio-embed">
      <span data-fde-controls="" contentEditable={false} aria-hidden className="studio-embed-controls" />
      <div className="studio-card-bar" contentEditable={false}>
        <Workflow size={14} aria-hidden />
        <span className="studio-card-src">{props.src ? `${DIAGRAMS_DIR}/${props.src}${DIAGRAM_SUFFIX}` : 'no src'}</span>
        {issues.length > 0 && (
          <span className="studio-diagram-issues" data-error={errors.length > 0 || undefined} title={issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n')}>
            {plural(issues.length, 'issue')}
          </span>
        )}
      </div>
      {props.title && (
        <span className="studio-embed-title" contentEditable={false}>
          {props.title}
        </span>
      )}
      {drawn && (
        <div className="studio-diagram-view dg" contentEditable={false}>
          {'failed' in drawn ? (
            <span className="studio-diagram-problem">{drawn.failed}</span>
          ) : drawn.svg ? (
            <div className="dg-canvas" dangerouslySetInnerHTML={{ __html: drawn.svg }} />
          ) : (
            <span className="studio-diagram-problem">{errors[0]?.message ?? 'This diagram does not draw.'}</span>
          )}
        </div>
      )}
      {children}
    </figure>
  );
}
