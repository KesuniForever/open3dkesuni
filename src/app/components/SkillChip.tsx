"use client";

import { SKILL_TEXT, type Skill } from "@/lib/agent/skills";
import { useT } from "@/i18n/client";

/** The skill label of a Chief step (set in code from the tool, not by the model). */
export default function SkillChip({ skill }: { skill: Skill }) {
  const t = useT();
  return <span className={`badge skill ${skill.toLowerCase()}`} title={`${t(skill)}: ${t(SKILL_TEXT[skill])}`}>{t(skill)}</span>;
}
