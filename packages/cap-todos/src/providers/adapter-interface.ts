export interface NormalizedTodoProject {
  id: string;
  name: string;
  color: string | null;
}

export interface NormalizedTodoItem {
  id: string;
  title: string;
  description: string;
  priority: number;
  status: 'pending' | 'completed';
  dueDate: string | null;
  dueTime: string | null;
  labels: string[];
  projectId: string | null;
  projectName: string | null;
  parentId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface TodoProviderAdapter {
  getProjects(): Promise<NormalizedTodoProject[]>;
  listItems(opts?: { since?: string }): Promise<NormalizedTodoItem[]>;
  createItem(input: {
    title: string;
    description?: string;
    priority?: number;
    dueDate?: string;
    dueTime?: string;
    labels?: string[];
    projectName?: string;
  }): Promise<NormalizedTodoItem>;
  updateItem(externalId: string, input: {
    title?: string;
    description?: string;
    priority?: number;
    status?: string;
    dueDate?: string;
    labels?: string[];
  }): Promise<NormalizedTodoItem>;
  completeItem(externalId: string): Promise<void>;
}
