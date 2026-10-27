/**
 * propose_plan — present a step-by-step plan and wait for the user to approve
 * or reject it (the TUI shows it in the side panel with clickable buttons).
 * exit_plan — explicitly exit plan mode with a final plan.
 */

import { requestPlanApproval } from "../agent/ui-bridge.js";

export async function proposePlan(args: { title?: string; steps: string[]; summary?: string }): Promise<string> {
  const steps = (args.steps || []).map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return "❌ A plan needs at least one step.";

  const decision = await requestPlanApproval({ title: args.title?.trim() || "Plan", steps, summary: args.summary });
  if (decision.approved) {
    return `✅ The user approved the plan. Carry it out step by step, tracking progress with write_todos.`;
  }
  return `⛔ The user rejected the plan${decision.feedback ? `: ${decision.feedback}` : ""}. Do not start the work. Ask what they would like changed, or propose a revised plan.`;
}

export async function exitPlan(args: { plan: string; steps?: string[]; summary?: string }): Promise<string> {
  const plan = args.plan?.trim() || "";
  if (!plan) return "❌ exit_plan requires a plan description.";
  const steps = Array.isArray(args.steps) ? args.steps.filter(Boolean) : [];
  const decision = await requestPlanApproval({ title: "Plan for approval", steps: steps.length ? steps : [plan.slice(0, 200)], summary: args.summary || plan.slice(0, 500) });
  if (decision.approved) {
    return `✅ Plan approved. Exit plan mode and begin implementation. Follow the approved plan step by step.`;
  }
  return `⛔ Plan rejected${decision.feedback ? `: ${decision.feedback}` : ""}. Revise the plan and call exit_plan again, or ask the user for clarification.`;
}
