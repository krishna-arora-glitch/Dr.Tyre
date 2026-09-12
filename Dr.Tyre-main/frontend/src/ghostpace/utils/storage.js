// frontend/src/utils/storage.js

const STORAGE_KEY = 'ghostpace_projects';

// Project Schema:
// {
//   id: string,
//   name: string,
//   session: string,
//   driverId: string | null,
//   compareDriverId: string | null,
//   createdAt: string,
//   lastModified: string
// }

export const storage = {
  getProjects: () => {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load projects from localStorage', e);
      return [];
    }
  },

  saveProject: (project) => {
    const projects = storage.getProjects();
    const existingIndex = projects.findIndex(p => p.id === project.id);
    
    project.lastModified = new Date().toISOString();
    
    if (existingIndex >= 0) {
      projects[existingIndex] = project;
    } else {
      project.createdAt = project.lastModified;
      projects.unshift(project); // Add to beginning
    }
    
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
      return project;
    } catch (e) {
      console.error('Failed to save project to localStorage', e);
      return null;
    }
  },

  deleteProject: (id) => {
    const projects = storage.getProjects();
    const filtered = projects.filter(p => p.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  },

  getProject: (id) => {
    const projects = storage.getProjects();
    return projects.find(p => p.id === id) || null;
  }
};
