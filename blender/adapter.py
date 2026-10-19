"""Fixed operations sent through Blender Lab MCP. Remote input is JSON, never code."""
import bpy
import json
import math
import os
import importlib.util
from mathutils import Matrix, Vector


def status():
    scene = bpy.context.scene
    return {'connected': True, 'version': bpy.app.version_string,
            'scene': scene.name, 'scenes': [s.name for s in bpy.data.scenes][:100],
            'objects': len(scene.objects), 'frame': scene.frame_current,
            'fps': scene.render.fps / scene.render.fps_base,
            'imports': [{'id': c['steve_import_id'], 'collection': c.name,
                         'document': c.get('steve_document', ''), 'revision': c.get('steve_revision', 0)}
                        for c in bpy.data.collections if c.get('steve_import_id')][:50]}


def collection_for(import_id):
    matches = [c for c in bpy.data.collections if c.get('steve_import_id') == import_id]
    if len(matches) != 1:
        raise ValueError('Import not found or ambiguous')
    return matches[0]


def record_motion_status(collection, imported, source, summary):
    collection['steve_animation_imported'] = bool(imported)
    collection['steve_motion_source'] = source
    collection['steve_motion_summary'] = summary
    return {'animation_imported': bool(imported),
            'geometry_source': collection['steve_source_format'],
            'motion_source': source, 'motion_summary': summary}


def bounds(objects, unit_scale=1):
    points = [o.matrix_world @ Vector(v) for o in objects if o.type == 'MESH' for v in o.bound_box]
    if not points:
        return None
    lo = [min(p[i] for p in points) for i in range(3)]
    hi = [max(p[i] for p in points) for i in range(3)]
    return {'min_m': [x*unit_scale for x in lo], 'max_m': [x*unit_scale for x in hi], 'size_mm': [(hi[i]-lo[i])*unit_scale*1000 for i in range(3)]}


def set_scene(scene):
    if bpy.context.window:
        bpy.context.window.scene = scene


def make_material(color, cache):
    if color in cache:
        return cache[color]
    if not isinstance(color, str) or len(color) not in (7, 9) or not color.startswith('#'):
        return None
    try:
        rgb = [int(color[i:i+2], 16)/255 for i in (1, 3, 5)]
        alpha = int(color[7:9], 16)/255 if len(color) == 9 else 1
    except ValueError:
        return None
    linear = [v/12.92 if v <= .04045 else ((v+.055)/1.055)**2.4 for v in rgb]
    material = bpy.data.materials.new('STEVE ' + color)
    material.diffuse_color = (*linear, alpha)
    material.use_nodes = True
    material.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (*linear, alpha)
    cache[color] = material
    return material


def import_model(p):
    if any(c.get('steve_import_id') == p['import_id'] for c in bpy.data.collections):
        raise ValueError('This import already exists; it was not repeated')
    previous_scene = bpy.context.scene
    previous_selection = list(bpy.context.selected_objects)
    previous_active = bpy.context.view_layer.objects.active
    previous_mode = bpy.context.mode
    if previous_mode != 'OBJECT':
        raise ValueError('Switch Blender to Object Mode before importing')
    # Target was captured when the request began, so a later UI scene switch cannot redirect it.
    target = p.get('target_scene')
    scene = bpy.data.scenes.get(target) if target else previous_scene
    if scene is None:
        raise ValueError('Target scene no longer exists')
    new_scene = p['destination'] == 'new'
    old_scenes = set(bpy.data.scenes)
    old_collections = set(bpy.data.collections)
    old_actions = set(bpy.data.actions)
    old_objects = set(bpy.data.objects)
    old_meshes = set(bpy.data.meshes)
    old_materials = set(bpy.data.materials)
    collection = None
    try:
        if new_scene:
            scene = bpy.data.scenes.new(p.get('scene_name') or p['name'])
            scene.unit_settings.system = 'METRIC'
            scene.unit_settings.scale_length = 1
            if p.get('motion'):
                scene.frame_end = 1
        set_scene(scene)
        collection = bpy.data.collections.new('STEVE · ' + p['name'])
        scene.collection.children.link(collection)
        collection['steve_import_id'] = p['import_id']
        collection['steve_document'] = p.get('document', '')
        collection['steve_revision'] = p.get('revision', 0)
        collection['steve_scene'] = scene.name
        collection['steve_created_scene'] = new_scene
        collection['steve_unit_scale'] = scene.unit_settings.scale_length
        mm = .001 / scene.unit_settings.scale_length
        collection['steve_sha256'] = p['sha256']
        collection['steve_source_format'] = p['format']
        if p['format'] == '3mf':
            with open(p['file'], encoding='utf8') as f:
                parts = json.load(f)
            materials = {}
            for part in parts:
                mesh = bpy.data.meshes.new(part['name'])
                mesh.from_pydata([[x*mm for x in v] for v in part['vertices']], [], part['triangles'])
                mesh.update()
                obj = bpy.data.objects.new(part['name'], mesh)
                collection.objects.link(obj)
                obj['steve_part_id'] = part['id']
                obj['steve_instance'] = part['name']
                # Uncoloured polygons use a neutral slot, not the first coloured face.
                # Blender initializes every polygon's material index to zero.
                face_materials = [make_material(color, materials) for color in part.get('colors', [])]
                if any(face_materials):
                    mesh.materials.append(make_material('#CCCCCC', materials))
                slots = {}
                for poly, color, material in zip(mesh.polygons, part.get('colors', []), face_materials):
                    if material:
                        if color not in slots:
                            slots[color] = len(mesh.materials)
                            mesh.materials.append(material)
                        poly.material_index = slots[color]
        elif p['format'] == 'glb':
            # Node validates self-contained GLB before this fixed import operator.
            with bpy.context.temp_override(scene=scene):
                bpy.ops.import_scene.gltf(filepath=p['file'])
            for obj in set(bpy.data.objects) - old_objects:
                if obj.name not in collection.objects:
                    collection.objects.link(obj)
                for other in list(obj.users_collection):
                    if other != collection:
                        other.objects.unlink(obj)
                obj['steve_instance'] = obj.name
            set_scene(scene)
            for extra in set(bpy.data.scenes) - old_scenes - {scene}:
                bpy.data.scenes.remove(extra)
            for extra in set(bpy.data.collections) - old_collections - {collection}:
                bpy.data.collections.remove(extra)
        else:
            raise ValueError('Unsupported model format')
        objects = list(collection.all_objects)
        if not any(o.type == 'MESH' for o in objects):
            raise ValueError('Import contains no mesh objects')
        bpy.context.view_layer.update()
        ranges = []
        if p['format'] == 'glb':
            ranges = [tuple(o.animation_data.action.frame_range) for o in objects if o.animation_data and o.animation_data.action]
            ranges += [(strip.frame_start, strip.frame_end) for o in objects if o.animation_data for track in o.animation_data.nla_tracks for strip in track.strips]
            if ranges:
                first, last = math.floor(min(r[0] for r in ranges)), math.ceil(max(r[1] for r in ranges))
                scene.frame_start = first if new_scene else min(scene.frame_start, first)
                scene.frame_end = last if new_scene else max(scene.frame_end, last)
        report = {'import_id': p['import_id'], 'scene': scene.name, 'collection': collection.name,
                  'objects': len(objects), 'meshes': sum(o.type == 'MESH' for o in objects),
                  'parts': [{'id': o.get('steve_part_id', ''), 'instance': o.get('steve_instance', ''), 'object': o.name}
                            for o in objects][:300], 'bounds': bounds(objects, scene.unit_settings.scale_length)}
        if p.get('motion'):
            report['motion'] = apply_motion({**p, 'operation': 'apply_motion'})
            for key in ['animation_imported', 'geometry_source', 'motion_source', 'motion_summary']:
                report[key] = report['motion'][key]
        elif p['format'] == '3mf':
            report.update(record_motion_status(collection, False, 'none',
                'Geometry only. 3MF contains no animation; no STEVE motion payload was supplied.'))
        elif ranges:
            report.update(record_motion_status(collection, True, 'glb',
                'Geometry and object animation imported from GLB.'))
        else:
            report.update(record_motion_status(collection, False, 'none',
                'Geometry only. No object animation was found in the GLB.'))
        for obj in bpy.context.selected_objects:
            obj.select_set(False)
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        return report
    except Exception:
        for obj in set(bpy.data.objects) - old_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        if collection:
            bpy.data.collections.remove(collection)
        for mesh in set(bpy.data.meshes) - old_meshes:
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        for mat in set(bpy.data.materials) - old_materials:
            if mat.users == 0:
                bpy.data.materials.remove(mat)
        set_scene(previous_scene)
        for extra in set(bpy.data.scenes) - old_scenes:
            bpy.data.scenes.remove(extra)
        for extra in set(bpy.data.collections) - old_collections:
            bpy.data.collections.remove(extra)
        for action in set(bpy.data.actions) - old_actions:
            if action.users == 0:
                bpy.data.actions.remove(action)
        for obj in previous_selection:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = previous_active
        raise


def apply_motion(p):
    collection = collection_for(p['import_id'])
    motion = p['motion']
    if (motion.get('document_id') != collection.get('steve_document') or
            motion.get('revision') != collection.get('steve_revision')):
        raise ValueError('Motion document and revision must match the imported geometry')
    if collection.get('steve_source_format') != '3mf':
        raise ValueError('Metadata motion applies only to 3MF; GLB carries its own animation')
    if collection.get('steve_motion'):
        raise ValueError('This collection already has motion; import a new collection for another clip')
    spec = importlib.util.spec_from_file_location('steve_motion', p['motion_module'])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    plan = module.prepare(motion['kinematics'], motion.get('clip'))
    scene = next((s for s in bpy.data.scenes if collection in list(s.collection.children_recursive)), None)
    if not scene:
        raise ValueError('Imported collection is not in a scene')
    if abs(scene.unit_settings.scale_length - collection.get('steve_unit_scale', 1)) > 1e-9:
        raise ValueError('Scene unit scale changed after import; reimport before adding motion')
    mm = .001 / scene.unit_settings.scale_length
    fps = scene.render.fps / scene.render.fps_base
    start = p.get('start_frame', 1)
    count = math.ceil(plan['duration'] * fps)
    if count > 18000 or len(plan['joints']) * (count+1) > 500000:
        raise ValueError('Motion exceeds bake limit')
    objects = list(collection.all_objects)
    if any(o.animation_data for o in objects):
        raise ValueError('Imported objects already have animation')
    mapping = motion.get('part_map', {})
    by_instance = {}
    for obj in objects:
        instance = mapping.get(obj.get('steve_part_id'), obj['steve_instance'])
        by_instance.setdefault(instance, []).append(obj)
    joints = {j['child']: j for j in plan['joints']}
    required = {j[k] for j in plan['joints'] for k in ('parent', 'child')}
    missing = sorted(required - set(by_instance))
    if missing:
        raise ValueError('Motion instances missing; provide part_map using import part IDs: ' + ', '.join(missing))
    if any(o.parent for o in objects):
        raise ValueError('Metadata motion requires unparented imported meshes')
    baseline = {o: o.matrix_world.copy() for o in objects}
    old_start, old_end, old_frame = scene.frame_start, scene.frame_end, scene.frame_current
    old_actions = set(bpy.data.actions)
    try:
        previous_quaternions = {}
        for i in range(count+1):
            values = module.values_at(plan, min(i/fps, plan['duration']))
            world = {}
            def pose(instance):
                if instance in world:
                    return world[instance]
                j = joints.get(instance)
                transform = Matrix.Identity(4)
                if j:
                    axis = Vector(j['axis']).normalized()
                    if j['type'] == 'slider':
                        transform = Matrix.Translation(axis * values[j['name']] * mm)
                    elif j['type'] == 'revolute':
                        origin = Vector(j['origin']) * mm
                        transform = Matrix.Translation(origin) @ Matrix.Rotation(math.radians(values[j['name']]), 4, axis) @ Matrix.Translation(-origin)
                    transform = pose(j['parent']) @ transform
                world[instance] = transform
                return transform
            for instance, members in by_instance.items():
                if instance not in joints:
                    continue
                transform = pose(instance)
                for obj in members:
                    obj.rotation_mode = 'QUATERNION'
                    obj.matrix_world = transform @ baseline[obj]
                    q = obj.rotation_quaternion.copy()
                    if obj in previous_quaternions and previous_quaternions[obj].dot(q) < 0:
                        q.negate()
                    obj.rotation_quaternion = q
                    previous_quaternions[obj] = q.copy()
                    obj.keyframe_insert(data_path='location', frame=start+i, group=plan['name'])
                    obj.keyframe_insert(data_path='rotation_quaternion', frame=start+i, group=plan['name'])
        # Frame-by-frame baking must interpolate linearly between samples.
        for action in set(bpy.data.actions) - old_actions:
            for layer in action.layers:
                for strip in layer.strips:
                    if strip.type == 'KEYFRAME':
                        for bag in strip.channelbags:
                            for curve in bag.fcurves:
                                for key in curve.keyframe_points:
                                    key.interpolation = 'LINEAR'
        if collection.get('steve_created_scene') and not any(o.animation_data for o in scene.objects if o not in objects):
            scene.frame_start, scene.frame_end = start, start+count
        else:
            scene.frame_start = min(scene.frame_start, start)
            scene.frame_end = max(scene.frame_end, start+count)
        scene.frame_set(start)
        collection['steve_motion'] = plan['name']
        collection['steve_motion_loop'] = plan['loop']
        result = {'import_id': p['import_id'], 'collection': collection.name, 'scene': scene.name,
                'clip': plan['name'], 'start_frame': start, 'end_frame': start+count,
                'duration_s': plan['duration'], 'fps': fps, 'samples': count+1,
                'loop_requested': plan['loop'], 'loop_behavior': 'Use Blender timeline playback range',
                'easing': plan['easing'], 'easing_note': 'ease is sampled as smoothstep',
                'animated_objects': sum(len(by_instance[c]) for c in joints)}
        result.update(record_motion_status(collection, True, 'steve_payload',
            f'STEVE motion payload imported: {plan["name"]} (frames {start}–{start+count}).'))
        return result
    except Exception:
        for obj in objects:
            obj.animation_data_clear()
            obj.matrix_world = baseline[obj]
        for action in set(bpy.data.actions) - old_actions:
            if action.users == 0:
                bpy.data.actions.remove(action)
        scene.frame_start, scene.frame_end = old_start, old_end
        scene.frame_set(old_frame)
        raise


def dispatch(p):
    operation = p['operation']
    if operation == 'status':
        return status()
    if operation == 'import_model':
        return import_model(p)
    if operation == 'apply_motion':
        return apply_motion(p)
    if operation == 'save_copy':
        if os.path.exists(p['file']):
            raise ValueError('Refusing to overwrite an existing blend file')
        bpy.ops.wm.save_as_mainfile(filepath=p['file'], copy=True)
        return {'saved': True, 'filename': os.path.basename(p['file'])}
    raise ValueError('Unknown operation')
