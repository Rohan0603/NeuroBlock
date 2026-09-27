import { parentPort } from 'node:worker_threads';

interface Request {
  readonly blocks: ArrayBuffer;
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly size: number;
  readonly start: { readonly x: number; readonly y: number; readonly z: number };
  readonly goal: { readonly x: number; readonly y: number; readonly z: number };
}

parentPort?.on('message', (request: Request) => {
  const blocks = new Uint16Array(request.blocks);
  const size = request.size;
  const index = (x: number, y: number, z: number) => y * size * size + z * size + x;
  const open = [{ point: request.start, score: 0 }];
  const cameFrom = new Map<string, { x: number; y: number; z: number }>();
  const key = (point: { x: number; y: number; z: number }) => `${point.x},${point.y},${point.z}`;
  const cost = new Map([[key(request.start), 0]]);
  const heuristic = (point: { x: number; y: number; z: number }) => Math.abs(point.x - request.goal.x) + Math.abs(point.y - request.goal.y) + Math.abs(point.z - request.goal.z);
  const directions: readonly (readonly [number, number, number])[] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];
  const isFree = (point: { x: number; y: number; z: number }) =>
    point.x >= 0 && point.y >= 0 && point.z >= 0 && point.x < size && point.y < size && point.z < size &&
    blocks[index(point.x, point.y, point.z)] === 0;
  if (!isFree(request.start)) {
    parentPort?.postMessage([]);
    return;
  }
  let result: { x: number; y: number; z: number }[] = [];
  while (open.length > 0 && open.length < 4096) {
    open.sort((left, right) => left.score - right.score);
    const current = open.shift()?.point;
    if (!current) break;
    if (current.x === request.goal.x && current.y === request.goal.y && current.z === request.goal.z) {
      const path = [current];
      let parent = cameFrom.get(key(current));
      while (parent) { path.unshift(parent); parent = cameFrom.get(key(parent)); }
      result = path;
      break;
    }
    for (const [dx, dy, dz] of directions) {
      const next = { x: current.x + dx, y: current.y + dy, z: current.z + dz };
      if (next.x < 0 || next.y < 0 || next.z < 0 || next.x >= size || next.y >= size || next.z >= size) continue;
      if (blocks[index(next.x, next.y, next.z)] !== 0) continue;
      const nextKey = key(next);
      const nextCost = (cost.get(key(current)) ?? 0) + 1;
      if (nextCost >= (cost.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      cost.set(nextKey, nextCost);
      cameFrom.set(nextKey, current);
      open.push({ point: next, score: nextCost + heuristic(next) });
    }
  }
  if (result.length === 0) {
    const next = directions.map(([dx, dy, dz]) => ({ x: request.start.x + dx, y: request.start.y + dy, z: request.start.z + dz })).find(isFree);
    result = next ? [request.start, next] : [];
  }
  parentPort?.postMessage(result);
});
