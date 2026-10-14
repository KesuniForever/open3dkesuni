import { SKILL_TEXT, type Skill } from "@/lib/agent/skills";

/** The skill label of a Chief step (set in code from the tool, not by the model). */
export default function SkillChip({ skill }: { skill: Skill }) {
  return <span className={`badge skill ${skill.toLowerCase()}`} title={`${skill}: ${SKILL_TEXT[skill]}`}>{skill}</span>;
}
