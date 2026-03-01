/// <reference types="vite/client" />

declare module "d3-delaunay" {
  export const Delaunay: {
    from(points: ArrayLike<[number, number]>): {
      voronoi(bounds: [number, number, number, number]): {
        cellPolygon(index: number): Iterable<[number, number]> | null;
      };
    };
  };
}
