"""
The canopy actions: the leaf-area field, the mesh a viewer can draw, and the
stand grown from what the satellite measured over an area.

Each reads its request, runs the product, and writes one JSON object to stdout.
"""

from __future__ import annotations

import json
import sys

import numpy as np

from terra import protocol


# The leaf-area-density field of one periodic orchard module, plus the
# transmittances a second implementation of the march has to reproduce.
#
# The grid leaves as a binary file rather than inside the JSON: a 27x27x16
# field is 47 kB of float32 and several times that as decimal text, and the
# consumer uploads it to a texture, where it wants to be bytes anyway.
def canopy_field(req, work_dir):
    protocol.emit_progress(5, 'building the canopy field')
    source = req.get('source', 'ellipsoid')
    leaf_positions = req.get('leaf_positions')
    leaf_areas = req.get('leaf_areas')
    grow_meta = None

    # Helios is only ever asked for architecture. Its ImportError is caught
    # apart from every other failure, because "you do not have this package"
    # and "this package misbehaved" call for different things from the
    # reader, and an uncaught one would reach the user as `exit status 1`.
    if source == 'helios':
        try:
            # helios_grow itself imports without the toolkit, so a species
            # list can be offered on a machine that cannot grow anything;
            # the ImportError arrives from grow(). Catching it here rather
            # than around the import is what keeps the message specific.
            from terra.canopy import helios_grow as helios_grow
            grown = helios_grow.grow(
                species=req.get('species', 'almond'),
                days=int(req.get('days', 120)),
                seed=req.get('seed'))
        except ImportError as e:
            protocol.fail('Growing a 3D crop needs the pyhelios3d package, which '
                 'installs as the module `pyhelios`. This interpreter does '
                 'not have it: run `pip install pyhelios3d` there, or '
                 'choose another Python in Settings > System. Canopies '
                 f'from ellipsoid crowns need nothing extra. ({e})')
        except Exception as e:
            protocol.fail(f'growing the plant failed: {e}')
        try:
            protocol.emit_progress(35, f'extracting {grown.species} at day {grown.days}')
            pos, area, grow_meta = helios_grow.leaf_cloud(grown)
        except Exception as e:
            protocol.fail(f'extracting the grown scene failed: {e}')
        source, leaf_positions, leaf_areas = 'leaves', pos, area

    from terra.canopy import field as cfield
    spec = cfield.FieldSpec(
        source=source,
        spacing=protocol.request_number(req, 'spacing', 6.0),
        cell=protocol.request_number(req, 'cell', 0.30),
        lai=protocol.request_number(req, 'lai', 2.0),
        z_top=protocol.request_number(req, 'z_top', None),
        n_reference=protocol.request_number(req, 'n_reference', 64, int),
        step_frac=protocol.request_number(req, 'step_frac', 0.5),
        height=protocol.request_number(req, 'height', 0.9),
        row_width_frac=protocol.request_number(req, 'row_width_frac', 0.6),
        base=protocol.request_number(req, 'base', 0.0),
        crown_a=protocol.request_number(req, 'crown_a', 1.8),
        crown_b=protocol.request_number(req, 'crown_b', 1.2),
        crown_z=protocol.request_number(req, 'crown_z', 1.6),
        leaf_positions=leaf_positions,
        leaf_areas=leaf_areas,
    )
    try:
        grid, payload = cfield.build(spec, progress=protocol.emit_progress)
    except Exception as e:
        protocol.fail(f'canopy_field failed: {e}')

    try:
        import numpy as _np
        field_path = work_dir / 'canopy_field.f32'
        _np.ascontiguousarray(grid, dtype=_np.float32).tofile(str(field_path))
    except Exception as e:
        protocol.fail(f'writing the canopy field failed: {e}')

    payload['field']['path'] = str(field_path)
    payload['field']['bytes'] = int(grid.size * 4)
    if grow_meta is not None:
        payload['grown'] = grow_meta
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'canopy_field': payload}))
    sys.stdout.flush()


# A stand of plants as geometry, for a reader who wants to see the canopy.
#
# This is not the canopy field with a nicer surface on it. The field is a
# leaf-area density on a voxel grid: there is no leaf in it, and no
# rendering of it can show one, because the architecture was integrated away
# when it was built. This action keeps the architecture -- Helios grows the
# stand, the bridge pulls the triangles out by organ, and the mesh goes to
# the webview as glTF for three.js to draw.
#
# THE MESH IS LARGE AND THAT IS THE POINT. Twelve sorghum at day 60 is about
# 264,000 triangles. Fruit alone is a third of that -- a sorghum panicle,
# which nobody asked to see in a canopy -- so `organs` selects, defaulting
# to the vegetative structure. Growing is ~2 s for twenty plants, and the
# mesh is written once per request rather than per frame.
def canopy_mesh(req, work_dir):
    protocol.emit_progress(5, 'growing the stand')
    # Read once. The payload echoes the stand it grew, and reading the request
    # a second time down there is how the two spellings of a default drift
    # apart: a response that says four rows for a stand grown with five.
    stand = {
        'rows': protocol.request_number(req, 'rows', 4, int),
        'per_row': protocol.request_number(req, 'per_row', 5, int),
        'inter_row': protocol.request_number(req, 'inter_row', 0.8),
        'inter_plant': protocol.request_number(req, 'inter_plant', 0.2),
    }
    try:
        from terra.canopy import helios_grow as helios_grow
        grown = helios_grow.grow_canopy(
            species=req.get('species', 'sorghum'),
            days=protocol.request_number(req, 'days', 60, int),
            seed=req.get('seed'), **stand)
    except ImportError as e:
        protocol.fail('Growing a 3D canopy needs the pyhelios3d package, which '
             'installs as the module `pyhelios`. This interpreter does not '
             'have it: run `pip install -r requirements-helios.txt` there, '
             f'or choose another Python in Settings > System. ({e})')
    except Exception as e:
        protocol.fail(f'growing the stand failed: {e}')

    protocol.emit_progress(45, 'extracting the scene')
    try:
        from terra.canopy import helios_bridge as helios_bridge
        organs = req.get('organs') or ['leaf', 'petiole', 'other']
        scene = helios_bridge.extract(
            grown.ctx, organ_uuids=helios_grow.organ_uuids(grown))
        present = [o for o in organs if o in scene and len(scene[o]['tris'])]
        if not present:
            protocol.fail(f'the grown scene has none of the organs {organs}; it has '
                 f'{sorted(scene)}')
    except SystemExit:
        raise
    except Exception as e:
        protocol.fail(f'extracting the grown scene failed: {e}')

    protocol.emit_progress(75, 'writing the mesh')
    try:
        # GLB rather than glTF: a .gltf carries its buffer as a base64 data
        # URI, and the Go side base64s the file again to cross the webview
        # bridge, so 21 MB of geometry arrives as a 37 MB string and the
        # parser inside the webview exhausts its stack -- reported as
        # "Maximum call stack size exceeded", which names nothing. GLB keeps
        # the buffer binary, so there is one encoding on the path instead of
        # two, and write_glb indexes the vertices on the way out.
        mesh_path = work_dir / 'canopy_mesh.glb'
        helios_bridge.write_glb(scene, str(mesh_path), organs=present)
    except Exception as e:
        protocol.fail(f'writing the mesh failed: {e}')

    # The leaf area Helios reports for the stand, so a reader can tell this
    # is the same canopy the field would have been built from.
    pids = grown.plant_id if isinstance(grown.plant_id, list) else [grown.plant_id]
    payload = {
        'path': str(mesh_path),
        'bytes': int(mesh_path.stat().st_size),
        'species': grown.species,
        'days': grown.days,
        'plants': len(pids),
        **stand,
        'leaf_area': float(sum(grown.pa.getPlantLeafArea(p) for p in pids)),
        'organs': {o: int(len(scene[o]['tris'])) for o in present},
    }
    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'canopy_mesh': payload}))
    sys.stdout.flush()


# The AOI's own NDVI series, read as a canopy.
# #
#
# WHAT IT CONNECTS. Everything above this line either observes the ground or
# simulates a plant, and nothing crossed between them: the canopy actions take
# a species and an age from the reader, while lai_ndvi.py -- written to be
# exactly this bridge -- was imported by nothing but its own tests. This walks
# the AOI's vegetation-index series into leaf area index, asks the ladder which
# Helios age produces it, and reports what the answer is worth.
#
# TWO ANCHORS FOR THE AGE, AND BOTH ARE REPORTED. Leaf area gives one: the age
# whose plant carries the observed LAI. Phenology gives another, independent
# of it: days since green-up in the series itself. Where the isolated-plant
# model describes the field the two agree. Where they do not, the disagreement
# is the finding -- Helios grows a plant with no neighbours (measured: soybean
# at 60 days is 1.402 m2 alone and 1.371 m2 inside a 24-plant stand, a ratio of
# 0.98), so in a dense sowing it reaches a given leaf area far too early. This
# action does not choose between them, because choosing would hide the one
# thing a reader needs in order to trust or distrust the geometry.
#
# THE SUN IS THE AOI'S OWN, when a location is given. canopy_field's six
# REFERENCE_SUNS exist to cross-validate a shader and are not solar geometry;
# sun_position.prepare_hourly turns the POWER record for this cell into real (azimuth,
# elevation) with the beam energy that arrived at each, and the march is
# weighted by that instead of by six arbitrary directions. Without a location
# the reference suns still answer, and the payload says which was used.
#
# NO GEOMETRY CROSSES HERE. This returns series and scalars; the mesh is
# canopy_mesh's job, and a reader who wants to see the stand asks for it with
# the age this action resolved.
#
def canopy_from_aoi(req, work_dir):
    from terra.sun import cache as power_cache
    protocol.emit_progress(5, 'reading the vegetation index series')

    series = req.get('vi_series') or []
    # The classification already knows what grows here, so the species is a
    # consequence of the data rather than a field the reader fills from a
    # default that has nothing to do with the AOI. It suggests and refuses:
    # cane, coffee and eucalyptus have no plant in the library, and the
    # catch-all crop classes do not identify one.
    suggestion = None
    if req.get('class_stats'):
        try:
            from terra.canopy import species as crop_species
            suggestion = crop_species.suggest(req['class_stats'])
        except Exception as e:
            suggestion = {'species': None, 'why': f'suggestion failed: {e}'}
    if len(series) < 3:
        protocol.fail('a canopy needs a vegetation-index series; this run carries '
             f'{len(series)} observation(s), and three is the minimum the '
             'phenology smoother can label')

    dates = [str(p.get('date', '')) for p in series]
    ndvi = [float(p.get('ndvi_mean', 'nan')) for p in series]
    # An explicit species wins: the suggestion is the classification's
    # reading, and a reader who overrides it means to.
    species_name = req.get('species') or (
        (suggestion or {}).get('species') or 'sorghum')

    # Density from the sowing the reader set, which is how every other
    # canopy action states it. The ladder is per plant, so this is what
    # turns it into an LAI.
    inter_row = float(req.get('inter_row', 0.8))
    inter_plant = float(req.get('inter_plant', 0.25))
    if inter_row <= 0 or inter_plant <= 0:
        protocol.fail('row and plant spacing must both be positive')
    density = 1.0 / (inter_row * inter_plant)

    try:
        from terra import phenology as phen
        from terra.canopy import lai_ndvi, lai_to_age
    except ImportError as e:
        protocol.fail(f'the canopy bridge is unavailable: {e}')

    # Ordinal days for the smoother, which is by DATE and not by position:
    # a cloud-screened series is irregular, and a window counted in samples
    # averages across whatever survived.
    import datetime as _dt
    try:
        ordinals = [
            _dt.date.fromisoformat(d[:10]).toordinal() if d else None
            for d in dates
        ]
    except ValueError as e:
        protocol.fail(f'a date in the series is not ISO-8601: {e}')
    if any(o is None for o in ordinals):
        protocol.fail('every observation needs a date for the smoother to use')

    protocol.emit_progress(20, 'inverting NDVI to leaf area index')
    try:
        inverted = lai_ndvi.invert_series(ndvi, days=ordinals)
    except Exception as e:
        protocol.fail(f'the NDVI inversion failed: {e}')

    protocol.emit_progress(35, 'labelling phenological states')
    state_ids = phen.assign_states_from_ndvi(np.asarray(ndvi, dtype=float))
    state_slugs = {
        phen.STATE_SOIL: 'soil', phen.STATE_GREENUP: 'greenup',
        phen.STATE_MATURE: 'mature', phen.STATE_SENESCENCE: 'senescence',
        phen.STATE_FALLOW: 'fallow',
    }
    states = [state_slugs.get(int(s), 'soil') for s in state_ids]

    # THE INDEPENDENT AGE, COUNTED FROM ITS OWN CYCLE'S GREEN-UP.
    #
    # A year of Brazilian cropland holds more than one cycle -- a summer
    # crop and a safrinha, or a crop followed by a cover -- and taking the
    # first green-up of the whole series dates every later cycle from the
    # start of the file. Measured on a real AOI: the July and August 2026
    # observations were handed 344 days of age because the series begins
    # green in August 2025, when their own cycle had started weeks earlier.
    cycle_ids = phen.cycle_of(state_ids)
    cycle_list = phen.cycles(state_ids)
    greenup_by_cycle = {
        k: ordinals[c['greenup']] for k, c in enumerate(cycle_list)
    }

    protocol.emit_progress(50, 'matching leaf area to an age')
    try:
        resolved = lai_to_age.resolve_series(
            inverted['lai'], density, species_name,
            states=states, dates=dates)
    except lai_to_age.LadderError as e:
        protocol.fail(str(e))

    # THE LADDER IS A GROWTH CURVE AND A SEASON IS NOT.
    #
    # Helios plants only grow: leaf area rises with age and never falls, so
    # the ladder has no age for a canopy that is shedding. Past the peak the
    # inversion still answers -- a declining LAI matches a young plant -- but
    # the answer means "a plant carrying this much leaf", not "a canopy of
    # this age", and the two stop being the same thing.
    #
    # Left uncompared, that shows up as a disagreement growing to a hundred
    # days by the end of the season, which reads as the competition defect
    # and is not it. So the peak splits the series: before it the two ages
    # are measuring the same thing and their difference is informative;
    # after it the row says it is declining and offers no age comparison.
    lai_values = list(inverted['lai'])
    peak_index = int(np.nanargmax(lai_values)) if lai_values else 0
    # A duração da estação, para normalizar o progresso do campo contra o
    # do Helios. Do próprio NDVI, que é onde ela é observável.
    season_days = float(phen.phenology_metrics(ndvi, dates).get('los_days') or 0.0)
    for i, (row, o) in enumerate(zip(resolved, ordinals)):
        k = int(cycle_ids[i])
        start = greenup_by_cycle.get(k)
        since = None if start is None else float(o - start)
        row['cycle'] = k if k >= 0 else None
        row['days_since_greenup'] = since
        row['declining'] = i > peak_index
        if row['declining']:
            row['age_check'] = {
                'comparable': False,
                'why': ('a série já passou do pico e está perdendo folha; a '
                        'escada só cresce, então a idade que ela devolve é a '
                        'de uma planta com esta área foliar, não a deste '
                        'dossel'),
            }
        else:
            row['age_check'] = lai_to_age.disagreement(
                row.get('day'), row.get('plateau_day'), since, season_days)

    usable = [r for r in resolved if r.get('day') is not None]
    payload = {
        'species': species_name,
        'density': density,
        'inter_row': inter_row,
        'inter_plant': inter_plant,
        'reachable_lai': lai_to_age.reachable_lai(species_name, density),
        'species_suggestion': suggestion,
        # HOW MUCH OF THIS AOI IS THE CROP, because the series is an area
        # mean and a mean over mixed cover is not the crop's index.
        #
        # Measured on the soybean AOI this was built against: the peak
        # reads 0.314 with a standard deviation of 0.190, which for a
        # roughly even two-population mix puts the crop pixels near 0.50
        # and everything else near 0.12. So the LAI below is an area mean
        # and understates the crop by about that much. Reading the series
        # over crop pixels only is the fix, and it belongs upstream in the
        # index extraction rather than here.
        'crop_fraction': (
            None if not suggestion else suggestion.get('confidence')),
        'lai': inverted,
        'states': states,
        'phenology': phen.phenology_metrics(ndvi, dates),
        'resolved': resolved,
        'n_usable': len(usable),
        # The cycles the season was split into. More than one means the
        # window covers more than one crop, and every age below is measured
        # from its own cycle rather than from the start of the record.
        'cycles': [
            {
                'start': dates[c['start']],
                'end': dates[c['end']],
                'greenup': dates[c['greenup']],
                'n': c['end'] - c['start'] + 1,
            }
            for c in cycle_list
        ],
        'sun': {'source': 'reference'},
    }

    # WHICH DATE THE CANOPY IS BUILT FOR, decided here rather than inside
    # the sun block because the sun now depends on it.
    #
    # The densest canopy the ladder can actually build, which is where the
    # architecture matters: at low LAI every geometry transmits alike and
    # the answer says nothing.
    #
    # Not the peak of the series, which is the obvious choice and is wrong
    # often enough to matter -- a season that reaches the species' ceiling
    # has its peak AT the plateau, where the ladder returns no age at all,
    # and the naive `max` then silently fell through to the first usable
    # row: LAI 0.10 lit instead of 3.75.
    lit_row = max(usable, key=lambda r: r['lai'], default=None)

    # The AOI's own sun, when there is a point to ask POWER about.
    lat, lon = req.get('lat'), req.get('lon')
    if lat is not None and lon is not None:
        protocol.emit_progress(70, 'reading the solar record for this cell')
        try:
            from terra.sun import (
                nasa_power as sun_power,
                position as sun_position,
                record as sun_record,
            )
            cell_lon, cell_lat = sun_power.request_point(float(lon), float(lat))
            last_year = _dt.date.today().year - 1
            years = int(req.get('hourly_years', 3))
            start = f'{last_year - years + 1}0101'
            end = f'{last_year}1231'
            hourly, provenance = power_cache.cached_power_series(
                power_cache.power_cache_dir(req),
                'hourly', cell_lon, cell_lat, start, end,
                sun_power.HOURLY_PARAMS,
                lambda progress: sun_power.fetch(
                    'hourly', cell_lon, cell_lat, start, end,
                    progress=progress),
            )
            df, solpos = sun_position.prepare_hourly(
                hourly, cell_lat, cell_lon, float(req.get('elevation', 0.0)))

            # THE SEASON, WHICH IS THE LARGEST THING THIS BLOCK DECIDES.
            #
            # The record fetched above is three whole years, and averaging
            # all of it gives the sun of no particular time. This canopy is
            # dated -- it is one Sentinel-2 observation -- and season is the
            # bigger term by far: measured on this app's own cached POWER
            # records, faPAR varies 0.068 across months at one site against
            # 0.016 across the entire latitude range of Brazil.
            #
            # Until this window existed the panel printed "faPAR under the
            # real sun, on <date>" beside a sky averaged over every other
            # month of three years, which is a caption contradicting its own
            # number. Narrowing costs nothing: the parquet is already local
            # and the other years still contribute through the day-of-year
            # window, so a February canopy is lit by three Februaries.
            window_days = int(req.get('sun_window_days', 21))
            season = sun_record.doy_window_mask(
                df.index, (lit_row or {}).get('date'), window_days)
            if season is not None and bool(season.any()):
                df, solpos = df[season], solpos[season]
            else:
                window_days = None
            energy, el_edges = sun_position.beam_energy_histogram(df, solpos)
            # The diffuse share of what arrives, from the record rather than
            # assumed: a canopy lit by the beam alone is lit by a fraction
            # of a clear day and by almost nothing under cloud.
            ghi_sum = float(np.nansum(df['ghi'].to_numpy()))
            dhi_sum = float(np.nansum(df['dhi'].to_numpy()))
            dhi_share = (dhi_sum / ghi_sum) if ghi_sum > 0 else 0.0
            # One real day of the window rather than an hour-of-day mean.
            # Near the equator -- where these AOIs are -- the noon sun
            # passes within ten degrees of the zenith, azimuth swings tens
            # of degrees in half an hour there, and averaging it produces a
            # direction no sun ever occupied.
            track_day = sun_position.representative_day(df)
            track = sun_position.sun_track(df, solpos, track_day)
            payload['sun'] = {
                'source': 'power',
                'cell': [cell_lat, cell_lon],
                'years': years,
                'provenance': provenance,
                'beam_energy_total': float(np.sum(energy)),
                'n_azimuth_bins': int(energy.shape[0]),
                'n_elevation_bins': int(energy.shape[1]),
                'diffuse_share': dhi_share,
                # Which sky this is, so the reader is not left inferring it
                # from a caption. `window_days` None means the whole record
                # answered, which happens when no date resolved to an age.
                'window_days': window_days,
                'window_centre': (lit_row or {}).get('date') if window_days else None,
                'n_hours': int(len(df)),
                # THE SUN AS SOMETHING THAT CAN BE DRAWN, not only summed.
                #
                # Everything above describes the sky as totals and bin
                # counts, which a march consumes and a viewer cannot. A
                # scene handed those has no choice but to invent a light,
                # and the picture then shows a sun that had nothing to do
                # with the number beside it.
                #
                # `direction` is the beam-energy-weighted mean, so a scene
                # lit from it is lit by the same sun the faPAR came from.
                # `track` is one real day, hour by hour, for a viewer that
                # wants to move the sun rather than fix it.
                'direction': sun_position.mean_beam_direction(df, solpos),
                'clearness': sun_record.clearness(df),
                'track_date': (
                    str(track_day) if track_day is not None else None),
                'track': track,
            }

            # Light the canopy the series resolved, under that sun.
            #
            # MORE THAN ONE PLANT, BECAUSE ONE PLANT IS NOT AN ANSWER.
            # helios_grow draws a plant stochastically, and the draw is not
            # a rounding detail: measured here on soybean at 55 days with
            # everything else held -- same species, same age, same sowing,
            # leaf area rescaled to an identical LAI so only the shape can
            # differ -- five seeds spanned faPAR 0.703 to 0.799. That 0.096
            # is larger than the whole seasonal term the window above was
            # added to capture, and three times a 20% error in the LAI this
            # action works so hard to invert.
            #
            # Until this loop existed the action grew seed 7 and printed
            # `fapar.toFixed(3)`, so it reported three decimals of a number
            # whose own spread lands in the second. The band is the honest
            # form of the same computation, and no new data buys it: it is
            # the model's own variance, and it can only be sampled.
            #
            # Cost is why the default is three and not thirty. The march is
            # ~11 s and dominates; growing a plant is 0.24 s.
            if lit_row is not None:
                try:
                    from terra.canopy import field as cfield, helios_grow as hgrow
                    row_az = float(req.get('row_azimuth_deg', 0.0))
                    base_seed = int(req.get('seed', 7))
                    n_seeds = max(1, min(int(req.get('n_seeds', 3)), 12))
                    # One periodic module carrying one plant, so the LAI the
                    # march integrates is the sowing's and not the plant's.
                    module = float(np.sqrt(inter_row * inter_plant))
                    cell = module / max(int(round(module / 0.05)), 4)

                    runs = []
                    for i in range(n_seeds):
                        protocol.emit_progress(
                            80 + int(15 * i / n_seeds),
                            f'lighting canopy {i + 1} of {n_seeds}')
                        grown = hgrow.grow(species=species_name,
                                           days=int(round(lit_row['day'])),
                                           seed=base_seed + i)
                        pos, leaf_area, _m = hgrow.leaf_cloud(grown)
                        pos = np.asarray(pos, float).copy()
                        pos[:, 0] = np.mod(pos[:, 0] + module / 2, module)
                        pos[:, 1] = np.mod(pos[:, 1] + module / 2, module)
                        grid, fmeta = cfield.leaf_cloud_field(
                            pos, leaf_area, spacing=module, cell=cell)
                        one = cfield.light_under_sun(
                            cfield.canopy_of(grid, fmeta), energy, el_edges,
                            dhi_share=dhi_share, row_azimuth_deg=row_az)
                        # THE FRACTION OF GROUND UNDER LEAF, which is the
                        # one geometric number that tracks the answer.
                        # Measured here at fixed LAI: sweeping the canopy's
                        # horizontal extent moves faPAR 0.19 to 0.88 and
                        # faPAR follows cover almost proportionally, while
                        # sweeping its HEIGHT over a factor of 2.4 moves it
                        # 0.020. Reported so a reader with an observed cover
                        # -- which a nadir view gives cheaply, and which no
                        # 3D reconstruction is needed for -- can check the
                        # simulated canopy against the field's.
                        one['cover'] = float(
                            (grid.sum(axis=2) > 0).mean())
                        one['seed'] = base_seed + i
                        runs.append(one)

                    # The median run carries the headline, so the reported
                    # figures stay a self-consistent single canopy rather
                    # than a mean of quantities that do not average.
                    runs.sort(key=lambda r: r.get('fapar', 0.0))
                    lit = dict(runs[len(runs) // 2])
                    fapars = [float(r['fapar']) for r in runs]
                    covers = [float(r['cover']) for r in runs]
                    lit['ensemble'] = {
                        'n': len(runs),
                        'fapar_min': min(fapars),
                        'fapar_max': max(fapars),
                        'fapar_spread': max(fapars) - min(fapars),
                        'cover_min': min(covers),
                        'cover_max': max(covers),
                        'seeds': [int(r['seed']) for r in runs],
                    }
                    lit['date'] = lit_row.get('date')
                    lit['day'] = lit_row.get('day')
                    payload['light'] = lit
                except Exception as e:
                    payload['light'] = {'error': str(e)}
        except Exception as e:
            # A canopy answer is still worth having without the sun record,
            # so this degrades rather than fails, and says which it did.
            payload['sun'] = {'source': 'reference', 'why': str(e)}

    protocol.emit_progress(100, 'done')
    sys.stdout.write(json.dumps({'canopy_from_aoi': payload}))
    sys.stdout.flush()
