export type TriState = boolean | null;

export interface LifeEvent {
  date?: string;
  place?: string;
}

export interface Person {
  name: string;
  gender?: 'M' | 'F' | '';
  birth?: LifeEvent;
  death?: LifeEvent;
  address?: string;
  location?: string;
  photo?: string;
  bio?: string;
  notes?: string;
  parents: string[];
  spouses: { id: string; married?: string }[];
  show: { dob: TriState; address: TriState };
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

export type Relation = 'child' | 'spouse' | 'parent';
