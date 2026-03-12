// No persistent storage needed — this app is a stateless proxy to TRF1
export interface IStorage {}

export class MemStorage implements IStorage {}

export const storage = new MemStorage();
