export interface NexusProjectScaffoldContext<ProjectConfig = unknown> {
  homePath: string;
  projectRoot: string;
  worktreesRoot: string;
  projectConfig: ProjectConfig;
}

export interface NexusExtension<
  ProjectConfig = unknown,
  ProjectScaffoldResult = unknown,
> {
  id: string;
  name: string;
  installProjectFiles?(
    context: NexusProjectScaffoldContext<ProjectConfig>,
  ): ProjectScaffoldResult;
}
