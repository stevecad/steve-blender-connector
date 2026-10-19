'use strict';
const { DOMParser } = require('@xmldom/xmldom');
const { readZip } = require('./zip');
const IDENTITY = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
const children = (node, name) =>
  Array.from(node.childNodes || []).filter((n) => n.nodeType === 1 && n.localName === name);
function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('3MF must not contain DTDs or entities');
  let invalid = false;
  const doc = new DOMParser({
    onError: (level) => {
      if (level !== 'warning') invalid = true;
    },
  }).parseFromString(text, 'application/xml');
  if (invalid || !doc.documentElement) throw new Error('Malformed 3MF XML');
  return doc;
}
function transform(value) {
  if (!value) return IDENTITY;
  const m = value.trim().split(/\s+/).map(Number);
  if (m.length !== 12 || m.some((n) => !Number.isFinite(n)))
    throw new Error('Invalid 3MF transform');
  return m;
}
const apply = (p, m) => [
  p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11],
];
function inspect(buffer) {
  const zip = readZip(buffer);
  let modelPath = '3D/3dmodel.model';
  if (zip.has('_rels/.rels')) {
    const rel = xml(zip.get('_rels/.rels').toString());
    for (const r of Array.from(rel.getElementsByTagName('Relationship')))
      if (/\/3dmodel$/.test(r.getAttribute('Type')))
        modelPath = r.getAttribute('Target').replace(/^\//, '');
  }
  if (!zip.has(modelPath)) throw new Error('3MF model part is missing');
  const doc = xml(zip.get(modelPath).toString()),
    root = doc.documentElement;
  const factor = {
    micron: 0.001,
    millimeter: 1,
    centimeter: 10,
    inch: 25.4,
    foot: 304.8,
    meter: 1000,
  }[root.getAttribute('unit') || 'millimeter'];
  if (!factor) throw new Error('Unknown 3MF units');
  const resources = children(root, 'resources')[0],
    build = children(root, 'build')[0];
  if (!resources || !build) throw new Error('3MF resources or build is missing');
  const objects = new Map(children(resources, 'object').map((o) => [o.getAttribute('id'), o]));
  const materials = new Map(
    [...children(resources, 'basematerials'), ...children(resources, 'colorgroup')].map((m) => [
      m.getAttribute('id'),
      children(m, m.localName === 'basematerials' ? 'base' : 'color').map(
        (c) => c.getAttribute('displaycolor') || c.getAttribute('color'),
      ),
    ]),
  );
  const parts = [];
  let totalVertices = 0,
    totalTriangles = 0;
  function walk(id, chain, ancestors, label) {
    if (ancestors.includes(id) || ancestors.length > 40)
      throw new Error('Cyclic or deeply nested 3MF assembly');
    const object = objects.get(id);
    if (!object) throw new Error('3MF references a missing object');
    const name = object.getAttribute('name') || label || `Part ${parts.length + 1}`;
    const meshes = children(object, 'mesh');
    for (const mesh of meshes) {
      const vertexRoot = children(mesh, 'vertices')[0],
        triRoot = children(mesh, 'triangles')[0];
      if (!vertexRoot || !triRoot) throw new Error('Incomplete 3MF mesh');
      const vertices = children(vertexRoot, 'vertex').map((v) => {
        let point = ['x', 'y', 'z'].map((k) => Number(v.getAttribute(k)));
        if (point.some((n) => !Number.isFinite(n))) throw new Error('Invalid mesh coordinate');
        for (const m of chain) point = apply(point, m);
        point = point.map((n) => n * factor);
        if (point.some((n) => !Number.isFinite(n)))
          throw new Error('Non-finite transformed coordinate');
        return point;
      });
      const triangles = children(triRoot, 'triangle').map((t) => {
        const ids = ['v1', 'v2', 'v3'].map((k) => Number(t.getAttribute(k)));
        if (ids.some((n) => !Number.isInteger(n) || n < 0 || n >= vertices.length))
          throw new Error('Invalid mesh triangle');
        return ids;
      });
      const objectColor = materials.get(object.getAttribute('pid'))?.[
        Number(object.getAttribute('pindex') || 0)
      ];
      const colors = children(triRoot, 'triangle').map((t) => {
        const pid = t.getAttribute('pid') || object.getAttribute('pid');
        const pindex = t.getAttribute('p1') || object.getAttribute('pindex') || 0;
        return materials.get(pid)?.[Number(pindex)] || objectColor || null;
      });
      totalVertices += vertices.length;
      totalTriangles += triangles.length;
      if (totalVertices > 2000000 || totalTriangles > 4000000)
        throw new Error('Model exceeds connector mesh limit');
      if (!vertices.length || !triangles.length) throw new Error('Empty 3MF mesh');
      const min = [Infinity, Infinity, Infinity],
        max = [-Infinity, -Infinity, -Infinity];
      for (const v of vertices)
        for (let i = 0; i < 3; i++) {
          min[i] = Math.min(min[i], v[i]);
          max[i] = Math.max(max[i], v[i]);
        }
      parts.push({
        id: `part-${parts.length + 1}`,
        name,
        vertices,
        triangles,
        colors,
        bounds: { min, max },
      });
    }
    for (const group of children(object, 'components'))
      for (const component of children(group, 'component')) {
        if (Array.from(component.attributes).some((a) => a.localName === 'path'))
          throw new Error('External 3MF components are unsupported; export one self-contained 3MF');
        walk(
          component.getAttribute('objectid'),
          [transform(component.getAttribute('transform')), ...chain],
          [...ancestors, id],
          name,
        );
      }
  }
  for (const item of children(build, 'item')) {
    // Blender needs reference/non-printable objects as well.
    if (Array.from(item.attributes).some((a) => a.localName === 'path'))
      throw new Error('External build items are unsupported');
    walk(item.getAttribute('objectid'), [transform(item.getAttribute('transform'))], [], null);
  }
  if (!parts.length) throw new Error('Model has no mesh parts');
  return parts;
}
module.exports = { inspect };
