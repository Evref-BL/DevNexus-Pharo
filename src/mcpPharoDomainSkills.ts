import type { NexusSkillDefinition } from "dev-nexus";
import { pharoCiReproSkill } from "./mcpPharoDomainSkills/pharoCiRepro.js";
import { pharoImageGitHandoffSkill } from "./mcpPharoDomainSkills/pharoImageGitHandoff.js";
import { pharoProjectLoadSkill } from "./mcpPharoDomainSkills/pharoProjectLoad.js";
import { pharoVersionCompatSkill } from "./mcpPharoDomainSkills/pharoVersionCompat.js";

export { mcpPharoDomainSkillSourceCommit } from "./mcpPharoDomainSkillSupport.js";

export const mcpPharoDomainSkillPack: readonly NexusSkillDefinition[] = [
  pharoCiReproSkill,
  pharoImageGitHandoffSkill,
  pharoProjectLoadSkill,
  pharoVersionCompatSkill,
];
