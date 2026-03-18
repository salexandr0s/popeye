import type { TodoProviderAdapter, NormalizedTodoProject, NormalizedTodoItem } from './adapter-interface.js';

export class LocalTodoAdapter implements TodoProviderAdapter {
  async getProjects(): Promise<NormalizedTodoProject[]> {
    return [];
  }

  async listItems(): Promise<NormalizedTodoItem[]> {
    return [];
  }

  async createItem(): Promise<NormalizedTodoItem> {
    throw new Error('Local todos are managed directly through TodoService');
  }

  async updateItem(): Promise<NormalizedTodoItem> {
    throw new Error('Local todos are managed directly through TodoService');
  }

  async completeItem(): Promise<void> {
    throw new Error('Local todos are managed directly through TodoService');
  }
}
