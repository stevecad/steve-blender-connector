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
        self.actions = set(bpy.data.actions)
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
        for action in set(bpy.data.actions)-self.actions:
            if action.users == 0:
                bpy.data.actions.remove(action)
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

    def motion(self):
        return {'document_id':'test', 'revision':1, 'clip':'open_close', 'kinematics':{
            'version':1, 'units':{'angle':'deg','length':'mm'},
            'joints':[{'name':'slide','parent':'base','child':'jaw','type':'slider',
                'axis':[1,0,0],'origin':[0,0,0],'value':0}], 'couplings':[],
            'animations':[{'name':'open_close','easing':'linear', 'keys':[
                {'time':0,'values':{'slide':0}}, {'time':1,'values':{'slide':20}}]}]}}

    def two_parts(self):
        parts=json.loads(self.file.read_text())
        parts[0]['name']='base'
        parts.append({**parts[0], 'id':'part-2', 'name':'jaw'})
        self.file.write_text(json.dumps(parts))

    def test_geometry_only_result_and_collection_explain_missing_motion(self):
        result=adapter.import_model(self.payload)
        collection=adapter.collection_for(self.payload['import_id'])
        self.assertFalse(result['animation_imported'])
        self.assertEqual(result['geometry_source'], '3mf')
        self.assertEqual(result['motion_source'], 'none')
        self.assertIn('no STEVE motion payload', result['motion_summary'])
        self.assertFalse(collection['steve_animation_imported'])
        self.assertEqual(collection['steve_motion_summary'], result['motion_summary'])

    def test_geometry_and_motion_result_names_the_payload_clip_and_frames(self):
        self.two_parts()
        self.payload['motion']=self.motion()
        result=adapter.import_model(self.payload)
        collection=adapter.collection_for(self.payload['import_id'])
        self.assertTrue(result['animation_imported'])
        self.assertEqual(result['geometry_source'], '3mf')
        self.assertEqual(result['motion_source'], 'steve_payload')
        self.assertIn('open_close', result['motion_summary'])
        self.assertIn('1–25', result['motion_summary'])
        self.assertEqual(collection['steve_motion_source'], 'steve_payload')

    def test_adding_motion_updates_existing_collection_and_result(self):
        self.two_parts()
        imported=adapter.import_model(self.payload)
        self.assertFalse(imported['animation_imported'])
        result=adapter.apply_motion({**self.payload, 'motion':self.motion()})
        collection=adapter.collection_for(self.payload['import_id'])
        self.assertTrue(result['animation_imported'])
        self.assertEqual(result['collection'], collection.name)
        self.assertTrue(collection['steve_animation_imported'])
        self.assertEqual(collection['steve_motion_summary'], result['motion_summary'])

    def glb(self, animated):
        bpy.ops.preferences.addon_enable(module='io_scene_gltf2')
        mesh=bpy.data.meshes.new('GLB test')
        mesh.from_pydata([(0,0,0),(.01,0,0),(0,.01,0)],[],[(0,1,2)])
        source=bpy.data.objects.new('GLB source',mesh)
        self.before.collection.objects.link(source)
        for obj in bpy.context.selected_objects: obj.select_set(False)
        source.select_set(True);bpy.context.view_layer.objects.active=source
        source.animation_data_create()
        if animated:
            source.keyframe_insert('location',frame=1)
            source.location.x=.02;source.keyframe_insert('location',frame=25)
        file=pathlib.Path(self.temp.name)/'test.glb'
        bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',use_selection=True,
            use_active_scene=True,export_animations=True,export_animation_mode='ACTIVE_ACTIONS')
        return {**self.payload, 'file':str(file), 'format':'glb'}

    def test_static_glb_is_reported_as_geometry_only(self):
        result=adapter.import_model(self.glb(False))
        self.assertFalse(result['animation_imported'])
        self.assertEqual(result['geometry_source'], 'glb')
        self.assertEqual(result['motion_source'], 'none')
        self.assertIn('No object animation', result['motion_summary'])

    def test_animated_glb_reports_embedded_animation(self):
        result=adapter.import_model(self.glb(True))
        collection=adapter.collection_for(self.payload['import_id'])
        self.assertTrue(result['animation_imported'])
        self.assertEqual(result['geometry_source'], 'glb')
        self.assertEqual(result['motion_source'], 'glb')
        self.assertTrue(collection['steve_animation_imported'])

suite = unittest.defaultTestLoader.loadTestsFromTestCase(AdapterTests)
result = unittest.TextTestRunner(verbosity=2).run(suite)
if not result.wasSuccessful():
    raise RuntimeError('Blender adapter regression tests failed')
