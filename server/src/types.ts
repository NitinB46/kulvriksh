export type Show = { dob: boolean | null; address: boolean | null };

export interface LifeEvent {
  date?: string; // "YYYY", "YYYY-MM" or "YYYY-MM-DD"
  place?: string;
}

export interface Person {
  name: string;
  gender?: 'M' | 'F' | '';
  birth?: LifeEvent;
  death?: LifeEvent;
  address?: string;
  location?: string; // where the person lives now (city); shown publicly
  photo?: string; // e.g. "photos/P0042-1731500000.jpg"
  bio?: string;
  notes?: string;
  parents: string[];
  spouses: { id: string; married?: string }[];
  show: Show; // null = follow the tree setting
}

export interface Tree {
  id: string;
  title: string;
  root: string;
  order: number;
  visible: boolean;
  show: { dob: boolean; address: boolean };
}

export interface FamilyData {
  version: number;
  trees: Tree[];
  people: Record<string, Person>;
}
