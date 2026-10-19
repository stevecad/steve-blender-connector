"""Validated STEVE v1 rigid-body motion, evaluated without executing source code."""
import math


def finite(value):
    if isinstance(value, bool) or not isinstance(value, (float, int)) or not math.isfinite(value):
        raise ValueError('Motion values must be finite numbers')
    return float(value)


def vector(value):
    if not isinstance(value, (list, tuple)) or len(value) != 3:
        raise ValueError('Expected a three-component vector')
    return [finite(x) for x in value]


def prepare(kinematics, clip_name):
    if kinematics.get('version') != 1 or kinematics.get('units') != {'angle': 'deg', 'length': 'mm'}:
        raise ValueError('Only STEVE kinematics v1, millimetres/degrees is supported')
    joints = kinematics.get('joints', [])
    names, parents = set(), {}
    for j in joints:
        if j['name'] in names or j['child'] in parents:
            raise ValueError('Duplicate joint name or child')
        names.add(j['name'])
        parents[j['child']] = j['parent']
        if j['type'] not in ('rigid', 'revolute', 'slider', 'cylindrical'):
            raise ValueError('Unsupported joint type')
        if not any(vector(j['axis'])):
            raise ValueError('Zero joint axis')
        vector(j['origin'])
        if j['type'] == 'cylindrical':
            # Cylindrical representation varies: refuse until explicitly supported.
            raise ValueError('Cylindrical motion is not yet supported; use STEVE Animated GLB')
        finite(j.get('value', 0))
    for child in parents:
        seen, node = set(), child
        while node in parents:
            if node in seen:
                raise ValueError('Cyclic joint tree')
            seen.add(node)
            node = parents[node]
    couplings = kinematics.get('couplings', [])
    base = {j['name']: finite(j.get('value', 0)) for j in joints}
    for c in couplings:
        if c['name'] in base:
            raise ValueError('Duplicate coupling name')
        base[c['name']] = finite(c.get('value', 0))
        for name, ratio in c['gears'].items():
            if name not in names or finite(ratio) == 0:
                raise ValueError('Unsupported coupling target')
    animations = kinematics.get('animations', [])
    explodes = kinematics.get('explodes', [])
    clips = animations + explodes
    if clip_name:
        matches = [c for c in clips if c['name'] == clip_name]
        if len(matches) != 1:
            raise ValueError('Choose an existing, uniquely named animation or explode')
        clip = matches[0]
    elif len(clips) == 1:
        clip = clips[0]
    elif clips:
        raise ValueError('Choose a clip: ' + ', '.join(c['name'] for c in clips))
    else:
        raise ValueError('No keyframed animation or explode found; export a driven motion as Animated GLB')
    if clip in explodes:
        raise ValueError('Explode metadata is not yet supported; use STEVE Animated GLB')
    if clip.get('easing', 'ease') not in ('ease', 'linear'):
        raise ValueError('Unsupported easing')
    keys, state, prior = [], dict(base), -1
    for key in clip['keys']:
        t = finite(key['time'])
        if t < 0 or t <= prior:
            raise ValueError('Key times must be nonnegative and strictly increasing')
        for name, value in key['values'].items():
            if name not in base:
                raise ValueError('Unknown animation target: ' + name)
            state[name] = finite(value)
        keys.append((t, dict(state)))
        prior = t
    if not keys or keys[-1][0] <= 0 or keys[-1][0] > 600:
        raise ValueError('Animation duration must be within 0–600 seconds')
    if keys[0][0] > 0:
        keys.insert(0, (0, base))
    return {'joints': joints, 'couplings': couplings, 'keys': keys,
            'name': clip['name'], 'duration': keys[-1][0],
            'easing': clip.get('easing', 'ease'), 'loop': bool(clip.get('loop'))}


def values_at(plan, t):
    keys = plan['keys']
    values = dict(keys[-1][1])
    if t <= keys[0][0]:
        values = dict(keys[0][1])
    else:
        for (ta, a), (tb, b) in zip(keys, keys[1:]):
            if t <= tb:
                u = max(0, min(1, (t - ta) / (tb - ta)))
                if plan['easing'] == 'ease':
                    u = u * u * (3 - 2 * u)
                values = {name: a[name] + (b[name] - a[name]) * u for name in a}
                break
    for c in plan['couplings']:
        for name, ratio in c['gears'].items():
            values[name] += values[c['name']] * ratio
    return values
