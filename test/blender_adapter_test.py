"""Run with Blender --background --factory-startup --python this_file.py.
Never run this harness in a person's interactive Blender session.
"""
import bpy
import importlib.util
import json
import pathlib
import tempfile
import unittest
import uuid

if not bpy.app.background:
    raise RuntimeError('This test requires an isolated background Blender process')
ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('adapter', ROOT / 'blender' / 'adapter.py')
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.file = pathlib.Path(self.temp.name) / 'mesh.json'
        self.file.write_text(json.dumps([{'id':'part-1', 'name':'test',
            'vertices':[[0,0,0],[10,0,0],[10,10,0],[0,10,0]],
            'triangles':[[0,1,2],[0,2,3]], 'colors':['#FF0000',None]}]))
        self.before = bpy.context.scene
        self.scenes = set(bpy.data.scenes)
        self.objects = set(bpy.data.objects)
        self.collections = set(bpy.data.collections)
        self.meshes = set(bpy.data.meshes)
        self.materials = set(bpy.data.materials)
        self.payload = {'import_id':str(uuid.uuid4()), 'destination':'new', 'format':'3mf',
            'file':str(self.file), 'name':'Adapter test', 'document':'test', 'revision':1,
            'sha256':'0'*64, 'motion_module':str(ROOT/'blender/motion.py')}

    def tearDown(self):
        bpy.context.window.scene = self.before
        for obj in set(bpy.data.objects)-self.objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for scene in set(bpy.data.scenes)-self.scenes:
            bpy.data.scenes.remove(scene)
        for collection in set(bpy.data.collections)-self.collections:
            bpy.data.collections.remove(collection)
        for mesh in set(bpy.data.meshes)-self.meshes:
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        for mat in set(bpy.data.materials)-self.materials:
            if mat.users == 0:
                bpy.data.materials.remove(mat)
        self.temp.cleanup()

    def test_uncoloured_face_does_not_inherit_coloured_neighbour(self):
        adapter.import_model(self.payload)
        mesh = next(iter(set(bpy.data.meshes)-self.meshes))
        red, plain = [mesh.materials[p.material_index] for p in mesh.polygons]
        self.assertNotEqual(red, plain)
        self.assertAlmostEqual(red.diffuse_color[0], 1)
        self.assertAlmostEqual(red.diffuse_color[1], 0)
        self.assertAlmostEqual(plain.diffuse_color[0], plain.diffuse_color[1])

    def test_failed_motion_import_rolls_back_owned_geometry_and_scene(self):
        self.payload['motion'] = {'document_id':'wrong', 'revision':1, 'kinematics':{}}
        with self.assertRaisesRegex(ValueError, 'revision must match'):
            adapter.import_model(self.payload)
        self.assertEqual(set(bpy.data.scenes), self.scenes)
        self.assertEqual(set(bpy.data.objects), self.objects)
        self.assertEqual(set(bpy.data.collections), self.collections)
        self.assertEqual(set(bpy.data.materials), self.materials)
        self.assertEqual(bpy.context.scene, self.before)

    def test_current_scene_with_millimetre_units_retains_size(self):
        scale = self.before.unit_settings.scale_length
        try:
            self.before.unit_settings.scale_length = .001
            self.payload['destination'] = 'current'
            result = adapter.import_model(self.payload)
            self.assertAlmostEqual(result['bounds']['size_mm'][0], 10, places=4)
            self.assertEqual(set(bpy.data.scenes), self.scenes)
        finally:
            self.before.unit_settings.scale_length = scale

suite = unittest.defaultTestLoader.loadTestsFromTestCase(AdapterTests)
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    raise RuntimeError('Blender adapter regression tests failed')
