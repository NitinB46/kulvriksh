/** What a tree node needs from the tree around it (avoids a circular import). */
export abstract class TreeContext {
  abstract isOpen(id: string, depth: number): boolean;
  abstract toggle(id: string): void;
}
