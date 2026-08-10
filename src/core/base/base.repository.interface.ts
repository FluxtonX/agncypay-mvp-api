export interface IBaseRepository<T> {
  findMany(filter?: any): Promise<T[]>;
  findById(id: string): Promise<T | null>;
  create(data: any): Promise<T>;
  update(id: string, data: any): Promise<T>;
  softDelete(id: string): Promise<T>;
}
