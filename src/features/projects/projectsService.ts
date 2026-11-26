import type { AspectRatio, ProjectSummary } from "@/types";
import type { Project, ProjectData } from "@/types/project";
import { call, isDesktop } from "@/services/tauri";
import { normalizeProjectData } from "./defaults";

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!isDesktop()) return [];
  return call<ProjectSummary[]>("list_projects");
}

function fix(p: Project): Project {
  return { ...p, data: normalizeProjectData(p.data, p.aspectRatio) };
}

export async function createProject(name: string, aspectRatio: AspectRatio): Promise<Project> {
  const data = normalizeProjectData(null, aspectRatio);
  data.export.fileName = name;
  return fix(await call<Project>("create_project", { name, aspectRatio, data }));
}

export const getProject = async (id: string) => fix(await call<Project>("get_project", { id }));
export const saveProject = (id: string, data: ProjectData) =>
  call<string>("save_project", { id, aspectRatio: data.aspectRatio, data });
export const renameProject = (id: string, name: string) => call<void>("rename_project", { id, name });
export const duplicateProject = (id: string) => call<Project>("duplicate_project", { id });
export const deleteProject = (id: string) => call<void>("delete_project", { id });
export const importProjectFile = async () => {
  const p = await call<Project | null>("import_project_file");
  return p ? fix(p) : null;
};
export const projectFilePath = (id: string) => call<string>("project_file_path", { id });
