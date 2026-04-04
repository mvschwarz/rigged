import type { AgentSpecReview } from "../hooks/useSpecReview.js";
import { WorkflowCodePreview } from "./WorkflowScaffold.js";

interface AgentSpecDisplayProps {
  review?: AgentSpecReview | null;
  yaml: string;
  testIdPrefix?: string;
}

export function AgentSpecDisplay({ review, yaml, testIdPrefix = "agent" }: AgentSpecDisplayProps) {
  const profiles = review?.profiles ?? [];
  const resources = review?.resources ?? { skills: [], guidance: [], hooks: [], subagents: [] };
  const startup = review?.startup ?? { files: [], actions: [] };

  return (
    <>
      {/* Profiles */}
      {profiles.length > 0 && (
        <div data-testid={`${testIdPrefix}-profiles-section`} className="border border-stone-200 p-3">
          <div className="font-mono text-xs font-bold mb-2">Profiles</div>
          <div className="space-y-1">
            {profiles.map((p) => (
              <div key={p.name} className="font-mono text-[10px] flex justify-between">
                <span className="font-bold">{p.name}</span>
                {p.description && <span className="text-stone-500">{p.description}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resources */}
      <div data-testid={`${testIdPrefix}-resources-section`} className="border border-stone-200 p-3">
        <div className="font-mono text-xs font-bold mb-2">Resources</div>
        <div className="space-y-2 font-mono text-[10px]">
          {resources.skills.length > 0 && (
            <div>
              <span className="text-stone-500">Skills:</span>{" "}
              {resources.skills.map((s, i) => (
                <span key={i} className="inline-block bg-stone-100 px-1.5 py-0.5 mr-1 mb-0.5">{s}</span>
              ))}
            </div>
          )}
          {resources.guidance.length > 0 && (
            <div>
              <span className="text-stone-500">Guidance:</span>{" "}
              {resources.guidance.map((g, i) => (
                <span key={i} className="inline-block bg-stone-100 px-1.5 py-0.5 mr-1 mb-0.5">{g}</span>
              ))}
            </div>
          )}
          {resources.hooks.length > 0 && (
            <div>
              <span className="text-stone-500">Hooks:</span> {resources.hooks.join(", ")}
            </div>
          )}
        </div>
      </div>

      {/* Startup */}
      {(startup.files.length > 0 || startup.actions.length > 0) && (
        <div data-testid={`${testIdPrefix}-startup-section`} className="border border-stone-200 p-3">
          <div className="font-mono text-xs font-bold mb-2">Startup</div>
          {startup.files.length > 0 && (
            <div className="mb-2">
              <div className="font-mono text-[9px] text-stone-500 uppercase mb-1">Files</div>
              {startup.files.map((f, i) => (
                <div key={i} className="font-mono text-[10px]">
                  {f.path} {f.required && <span className="text-red-500 text-[8px]">REQUIRED</span>}
                </div>
              ))}
            </div>
          )}
          {startup.actions.length > 0 && (
            <div>
              <div className="font-mono text-[9px] text-stone-500 uppercase mb-1">Actions</div>
              {startup.actions.map((a, i) => (
                <div key={i} className="font-mono text-[10px]">
                  <span className="text-stone-500">{a.type}:</span> {a.value}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* YAML */}
      <WorkflowCodePreview title="YAML Preview" testId={`${testIdPrefix}-spec-yaml`}>
        {yaml}
      </WorkflowCodePreview>
    </>
  );
}
