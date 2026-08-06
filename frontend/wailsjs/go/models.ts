export namespace backend {
	
	export class GeoJSONGeometry {
	    type: string;
	    coordinates: number[][][];
	
	    static createFrom(source: any = {}) {
	        return new GeoJSONGeometry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.coordinates = source["coordinates"];
	    }
	}
	export class Bounds {
	    lon_min: number;
	    lat_min: number;
	    lon_max: number;
	    lat_max: number;
	
	    static createFrom(source: any = {}) {
	        return new Bounds(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon_min = source["lon_min"];
	        this.lat_min = source["lat_min"];
	        this.lon_max = source["lon_max"];
	        this.lat_max = source["lat_max"];
	    }
	}
	export class Area {
	    id: string;
	    label: string;
	    kml_name: string;
	    approximate: boolean;
	    centroid: number[];
	    bounds: Bounds;
	    mapbiomas: string;
	    geometry: GeoJSONGeometry;
	
	    static createFrom(source: any = {}) {
	        return new Area(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.kml_name = source["kml_name"];
	        this.approximate = source["approximate"];
	        this.centroid = source["centroid"];
	        this.bounds = this.convertValues(source["bounds"], Bounds);
	        this.mapbiomas = source["mapbiomas"];
	        this.geometry = this.convertValues(source["geometry"], GeoJSONGeometry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ClassStat {
	    class_id: number;
	    name: string;
	    color: string;
	    pixels: number;
	    pct: number;
	    area_ha: number;
	
	    static createFrom(source: any = {}) {
	        return new ClassStat(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.class_id = source["class_id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.pixels = source["pixels"];
	        this.pct = source["pct"];
	        this.area_ha = source["area_ha"];
	    }
	}
	export class CompositeRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    start: string;
	    end: string;
	    max_cloud: number;
	    monthly_best: boolean;
	    tiles: string[];
	    scene_id: string;
	    kind: string;
	    bands?: string[];
	    index?: string;
	    stretch_pct?: number[];
	
	    static createFrom(source: any = {}) {
	        return new CompositeRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.max_cloud = source["max_cloud"];
	        this.monthly_best = source["monthly_best"];
	        this.tiles = source["tiles"];
	        this.scene_id = source["scene_id"];
	        this.kind = source["kind"];
	        this.bands = source["bands"];
	        this.index = source["index"];
	        this.stretch_pct = source["stretch_pct"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CompositeResult {
	    extent: Bounds;
	    overlay_uri: string;
	    raster_tif?: string;
	    meta?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new CompositeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.extent = this.convertValues(source["extent"], Bounds);
	        this.overlay_uri = source["overlay_uri"];
	        this.raster_tif = source["raster_tif"];
	        this.meta = source["meta"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DataCubeRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    start: string;
	    end: string;
	    max_cloud: number;
	    monthly_best: boolean;
	    tiles: string[];
	
	    static createFrom(source: any = {}) {
	        return new DataCubeRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.max_cloud = source["max_cloud"];
	        this.monthly_best = source["monthly_best"];
	        this.tiles = source["tiles"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DataCubeScene {
	    id: string;
	    date: string;
	    cloud_cover: number;
	    tile: string;
	    satellite: string;
	    preview_uri?: string;
	
	    static createFrom(source: any = {}) {
	        return new DataCubeScene(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.date = source["date"];
	        this.cloud_cover = source["cloud_cover"];
	        this.tile = source["tile"];
	        this.satellite = source["satellite"];
	        this.preview_uri = source["preview_uri"];
	    }
	}
	export class DataCubeResult {
	    n_scenes: number;
	    scenes: DataCubeScene[];
	    date_range: string[];
	    monthly_best: boolean;
	    max_cloud: number;
	
	    static createFrom(source: any = {}) {
	        return new DataCubeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.n_scenes = source["n_scenes"];
	        this.scenes = this.convertValues(source["scenes"], DataCubeScene);
	        this.date_range = source["date_range"];
	        this.monthly_best = source["monthly_best"];
	        this.max_cloud = source["max_cloud"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class GeocodeResult {
	    display_name: string;
	    lat: number;
	    lon: number;
	    bounding_box: number[];
	
	    static createFrom(source: any = {}) {
	        return new GeocodeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.display_name = source["display_name"];
	        this.lat = source["lat"];
	        this.lon = source["lon"];
	        this.bounding_box = source["bounding_box"];
	    }
	}
	export class LULCCompareRow {
	    class_id: number;
	    name: string;
	    color: string;
	    pct_ref: number;
	    pct_pred: number;
	    pixels_ref: number;
	    n_reference_cells?: number;
	
	    static createFrom(source: any = {}) {
	        return new LULCCompareRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.class_id = source["class_id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.pct_ref = source["pct_ref"];
	        this.pct_pred = source["pct_pred"];
	        this.pixels_ref = source["pixels_ref"];
	        this.n_reference_cells = source["n_reference_cells"];
	    }
	}
	export class LULCGroupRow {
	    group: string;
	    color: string;
	    pct: number;
	    area_ha: number;
	
	    static createFrom(source: any = {}) {
	        return new LULCGroupRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.group = source["group"];
	        this.color = source["color"];
	        this.pct = source["pct"];
	        this.area_ha = source["area_ha"];
	    }
	}
	export class LULCClassRow {
	    class_id: number;
	    name: string;
	    color: string;
	    group: string;
	    pixels: number;
	    pct: number;
	    area_ha: number;
	
	    static createFrom(source: any = {}) {
	        return new LULCClassRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.class_id = source["class_id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.group = source["group"];
	        this.pixels = source["pixels"];
	        this.pct = source["pct"];
	        this.area_ha = source["area_ha"];
	    }
	}
	export class LULCMetrics {
	    area_ha: number;
	    n_pixels: number;
	    n_classes: number;
	    shannon_h: number;
	    pielou_j: number;
	    dominant_class: string;
	    dominant_pct: number;
	    soja_pct: number;
	    outras_lav_pct: number;
	    agricola_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new LULCMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_ha = source["area_ha"];
	        this.n_pixels = source["n_pixels"];
	        this.n_classes = source["n_classes"];
	        this.shannon_h = source["shannon_h"];
	        this.pielou_j = source["pielou_j"];
	        this.dominant_class = source["dominant_class"];
	        this.dominant_pct = source["dominant_pct"];
	        this.soja_pct = source["soja_pct"];
	        this.outras_lav_pct = source["outras_lav_pct"];
	        this.agricola_pct = source["agricola_pct"];
	    }
	}
	export class LULCAnalysis {
	    year: number;
	    source: string;
	    map_uri?: string;
	    map_png?: string;
	    extent: Bounds;
	    metrics: LULCMetrics;
	    composition: LULCClassRow[];
	    groups: LULCGroupRow[];
	    pred_vs_ref: LULCCompareRow[];
	    compare_pixels?: number;
	    compare_reference_cells?: number;
	
	    static createFrom(source: any = {}) {
	        return new LULCAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.year = source["year"];
	        this.source = source["source"];
	        this.map_uri = source["map_uri"];
	        this.map_png = source["map_png"];
	        this.extent = this.convertValues(source["extent"], Bounds);
	        this.metrics = this.convertValues(source["metrics"], LULCMetrics);
	        this.composition = this.convertValues(source["composition"], LULCClassRow);
	        this.groups = this.convertValues(source["groups"], LULCGroupRow);
	        this.pred_vs_ref = this.convertValues(source["pred_vs_ref"], LULCCompareRow);
	        this.compare_pixels = source["compare_pixels"];
	        this.compare_reference_cells = source["compare_reference_cells"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	export class LULCRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    mapbiomas_path?: string;
	
	    static createFrom(source: any = {}) {
	        return new LULCRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.mapbiomas_path = source["mapbiomas_path"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PhenologyMetrics {
	    sos_doy?: number;
	    pos_doy?: number;
	    eos_doy?: number;
	    los_days?: number;
	    peak?: number;
	    base?: number;
	    amplitude?: number;
	
	    static createFrom(source: any = {}) {
	        return new PhenologyMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sos_doy = source["sos_doy"];
	        this.pos_doy = source["pos_doy"];
	        this.eos_doy = source["eos_doy"];
	        this.los_days = source["los_days"];
	        this.peak = source["peak"];
	        this.base = source["base"];
	        this.amplitude = source["amplitude"];
	    }
	}
	export class PhenologyStatePoint {
	    date: string;
	    state: number;
	    state_name: string;
	    color: string;
	    ndvi_mean?: number;
	
	    static createFrom(source: any = {}) {
	        return new PhenologyStatePoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.state = source["state"];
	        this.state_name = source["state_name"];
	        this.color = source["color"];
	        this.ndvi_mean = source["ndvi_mean"];
	    }
	}
	export class PredictRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    start: string;
	    end: string;
	    max_cloud: number;
	    monthly_best: boolean;
	    tiles: string[];
	    mode: string;
	    model_kind: string;
	    prithvi_mode: string;
	    project_id?: string;
	    label?: string;
	    run_label?: string;
	
	    static createFrom(source: any = {}) {
	        return new PredictRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.max_cloud = source["max_cloud"];
	        this.monthly_best = source["monthly_best"];
	        this.tiles = source["tiles"];
	        this.mode = source["mode"];
	        this.model_kind = source["model_kind"];
	        this.prithvi_mode = source["prithvi_mode"];
	        this.project_id = source["project_id"];
	        this.label = source["label"];
	        this.run_label = source["run_label"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SolarSitingThresholds {
	    slope_acceptable_deg: number;
	    slope_restrictive_deg: number;
	    excluded_cover: number[];
	    cropland_cover: number[];
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new SolarSitingThresholds(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.slope_acceptable_deg = source["slope_acceptable_deg"];
	        this.slope_restrictive_deg = source["slope_restrictive_deg"];
	        this.excluded_cover = source["excluded_cover"];
	        this.cropland_cover = source["cropland_cover"];
	        this.note = source["note"];
	    }
	}
	export class SolarSitingClass {
	    code: number;
	    name: string;
	    color: string;
	    pixels: number;
	    area_ha: number;
	    pct: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarSitingClass(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.code = source["code"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.pixels = source["pixels"];
	        this.area_ha = source["area_ha"];
	        this.pct = source["pct"];
	    }
	}
	export class SolarSitingAnalysis {
	    classes: SolarSitingClass[];
	    suitable_no_conflict_ha: number;
	    suitable_cropland_ha: number;
	    pixel_area_ha: number;
	    thresholds: SolarSitingThresholds;
	    dem_source: string;
	    overlay_uri: string;
	    raster_tif: string;
	    extent: Bounds;
	
	    static createFrom(source: any = {}) {
	        return new SolarSitingAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.classes = this.convertValues(source["classes"], SolarSitingClass);
	        this.suitable_no_conflict_ha = source["suitable_no_conflict_ha"];
	        this.suitable_cropland_ha = source["suitable_cropland_ha"];
	        this.pixel_area_ha = source["pixel_area_ha"];
	        this.thresholds = this.convertValues(source["thresholds"], SolarSitingThresholds);
	        this.dem_source = source["dem_source"];
	        this.overlay_uri = source["overlay_uri"];
	        this.raster_tif = source["raster_tif"];
	        this.extent = this.convertValues(source["extent"], Bounds);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SolarRenderScale {
	    palette: string;
	    min: number;
	    max: number;
	    reference?: number;
	    basis: string;
	    shared_with: string;
	    decimals: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarRenderScale(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.palette = source["palette"];
	        this.min = source["min"];
	        this.max = source["max"];
	        this.reference = source["reference"];
	        this.basis = source["basis"];
	        this.shared_with = source["shared_with"];
	        this.decimals = source["decimals"];
	    }
	}
	export class SolarTerrainAnalysis {
	    poa_min: number;
	    poa_max: number;
	    poa_mean: number;
	    poa_std_pct: number;
	    slope_mean_deg: number;
	    slope_max_deg: number;
	    pixels: number;
	    hourly_years: number;
	    dem_source: string;
	    season: string;
	    unit: string;
	    scale: SolarRenderScale;
	    shading_mean_pct?: number;
	    shading_max_pct?: number;
	    horizon_max_dist_m: number;
	    beam_fraction: number;
	    overlay_uri: string;
	    raster_tif: string;
	    extent: Bounds;
	
	    static createFrom(source: any = {}) {
	        return new SolarTerrainAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.poa_min = source["poa_min"];
	        this.poa_max = source["poa_max"];
	        this.poa_mean = source["poa_mean"];
	        this.poa_std_pct = source["poa_std_pct"];
	        this.slope_mean_deg = source["slope_mean_deg"];
	        this.slope_max_deg = source["slope_max_deg"];
	        this.pixels = source["pixels"];
	        this.hourly_years = source["hourly_years"];
	        this.dem_source = source["dem_source"];
	        this.season = source["season"];
	        this.unit = source["unit"];
	        this.scale = this.convertValues(source["scale"], SolarRenderScale);
	        this.shading_mean_pct = source["shading_mean_pct"];
	        this.shading_max_pct = source["shading_max_pct"];
	        this.horizon_max_dist_m = source["horizon_max_dist_m"];
	        this.beam_fraction = source["beam_fraction"];
	        this.overlay_uri = source["overlay_uri"];
	        this.raster_tif = source["raster_tif"];
	        this.extent = this.convertValues(source["extent"], Bounds);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SolarPV {
	    specific_yield_kwh_kwp_year: number;
	    performance_ratio: number;
	    performance_ratio_source: string;
	    performance_ratio_modelled: number;
	    capacity_factor_pct: number;
	    hourly_years: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarPV(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.specific_yield_kwh_kwp_year = source["specific_yield_kwh_kwp_year"];
	        this.performance_ratio = source["performance_ratio"];
	        this.performance_ratio_source = source["performance_ratio_source"];
	        this.performance_ratio_modelled = source["performance_ratio_modelled"];
	        this.capacity_factor_pct = source["capacity_factor_pct"];
	        this.hourly_years = source["hourly_years"];
	    }
	}
	export class SolarTiltLoss {
	    deviation_deg: number;
	    loss_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarTiltLoss(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.deviation_deg = source["deviation_deg"];
	        this.loss_pct = source["loss_pct"];
	    }
	}
	export class SolarGeometry {
	    optimal_tilt_deg: number;
	    optimal_poa_kwh_m2_year: number;
	    surface_azimuth_deg: number;
	    gain_over_horizontal_pct: number;
	    tilt_tolerance: SolarTiltLoss[];
	
	    static createFrom(source: any = {}) {
	        return new SolarGeometry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.optimal_tilt_deg = source["optimal_tilt_deg"];
	        this.optimal_poa_kwh_m2_year = source["optimal_poa_kwh_m2_year"];
	        this.surface_azimuth_deg = source["surface_azimuth_deg"];
	        this.gain_over_horizontal_pct = source["gain_over_horizontal_pct"];
	        this.tilt_tolerance = this.convertValues(source["tilt_tolerance"], SolarTiltLoss);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SolarMonth {
	    month: number;
	    ghi?: number;
	    dni?: number;
	    dhi?: number;
	    kt?: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarMonth(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.ghi = source["ghi"];
	        this.dni = source["dni"];
	        this.dhi = source["dhi"];
	        this.kt = source["kt"];
	    }
	}
	export class SolarResource {
	    ghi_annual_kwh_m2: number;
	    ghi_std: number;
	    ghi_cv_pct: number;
	    ghi_p10: number;
	    ghi_p90: number;
	    n_years: number;
	    trend_per_year: number;
	    trend_p_value: number;
	    clear_sky_index?: number;
	    monthly: SolarMonth[];
	
	    static createFrom(source: any = {}) {
	        return new SolarResource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ghi_annual_kwh_m2 = source["ghi_annual_kwh_m2"];
	        this.ghi_std = source["ghi_std"];
	        this.ghi_cv_pct = source["ghi_cv_pct"];
	        this.ghi_p10 = source["ghi_p10"];
	        this.ghi_p90 = source["ghi_p90"];
	        this.n_years = source["n_years"];
	        this.trend_per_year = source["trend_per_year"];
	        this.trend_p_value = source["trend_p_value"];
	        this.clear_sky_index = source["clear_sky_index"];
	        this.monthly = this.convertValues(source["monthly"], SolarMonth);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SolarAnalysis {
	    lon: number;
	    lat: number;
	    resource: SolarResource;
	    geometry: SolarGeometry;
	    pv: SolarPV;
	    grid_note: string;
	
	    static createFrom(source: any = {}) {
	        return new SolarAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.resource = this.convertValues(source["resource"], SolarResource);
	        this.geometry = this.convertValues(source["geometry"], SolarGeometry);
	        this.pv = this.convertValues(source["pv"], SolarPV);
	        this.grid_note = source["grid_note"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class WaterDate {
	    date: string;
	    scene_id: string;
	    cloud_cover: number;
	    observed_pixels: number;
	    threshold_fixed: number;
	    threshold_otsu: number;
	    threshold_clipped: boolean;
	    threshold_degenerate: boolean;
	    water_fraction_pct: number;
	    water_fraction_otsu_pct: number;
	    water_pixels: number;
	    area_ha: number;
	
	    static createFrom(source: any = {}) {
	        return new WaterDate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.scene_id = source["scene_id"];
	        this.cloud_cover = source["cloud_cover"];
	        this.observed_pixels = source["observed_pixels"];
	        this.threshold_fixed = source["threshold_fixed"];
	        this.threshold_otsu = source["threshold_otsu"];
	        this.threshold_clipped = source["threshold_clipped"];
	        this.threshold_degenerate = source["threshold_degenerate"];
	        this.water_fraction_pct = source["water_fraction_pct"];
	        this.water_fraction_otsu_pct = source["water_fraction_otsu_pct"];
	        this.water_pixels = source["water_pixels"];
	        this.area_ha = source["area_ha"];
	    }
	}
	export class WaterAnalysis {
	    index: string;
	    threshold_method: string;
	    threshold_fixed: number;
	    otsu_clip: number[];
	    n_dates: number;
	    date_range: string[];
	    aoi_pixels: number;
	    aoi_area_ha: number;
	    series: WaterDate[];
	    peak_date: string;
	    peak_water_fraction_pct: number;
	    ephemeral_pixels: number;
	    ephemeral_area_ha: number;
	    persistent_pixels: number;
	    persistent_area_ha: number;
	    mean_anomaly: number;
	    occurrence_uri: string;
	    extent: Bounds;
	
	    static createFrom(source: any = {}) {
	        return new WaterAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.threshold_method = source["threshold_method"];
	        this.threshold_fixed = source["threshold_fixed"];
	        this.otsu_clip = source["otsu_clip"];
	        this.n_dates = source["n_dates"];
	        this.date_range = source["date_range"];
	        this.aoi_pixels = source["aoi_pixels"];
	        this.aoi_area_ha = source["aoi_area_ha"];
	        this.series = this.convertValues(source["series"], WaterDate);
	        this.peak_date = source["peak_date"];
	        this.peak_water_fraction_pct = source["peak_water_fraction_pct"];
	        this.ephemeral_pixels = source["ephemeral_pixels"];
	        this.ephemeral_area_ha = source["ephemeral_area_ha"];
	        this.persistent_pixels = source["persistent_pixels"];
	        this.persistent_area_ha = source["persistent_area_ha"];
	        this.mean_anomaly = source["mean_anomaly"];
	        this.occurrence_uri = source["occurrence_uri"];
	        this.extent = this.convertValues(source["extent"], Bounds);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class VISeriesPoint {
	    date: string;
	    ndvi_mean: number;
	    ndvi_std: number;
	    evi_mean: number;
	    evi_std: number;
	    savi_mean: number;
	    savi_std: number;
	
	    static createFrom(source: any = {}) {
	        return new VISeriesPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.ndvi_mean = source["ndvi_mean"];
	        this.ndvi_std = source["ndvi_std"];
	        this.evi_mean = source["evi_mean"];
	        this.evi_std = source["evi_std"];
	        this.savi_mean = source["savi_mean"];
	        this.savi_std = source["savi_std"];
	    }
	}
	export class TemporalPoint {
	    date: string;
	    n_dates_stack: number;
	    soja_ndvi_mean?: number;
	    soja_retention_pct?: number;
	    dominant?: string;
	
	    static createFrom(source: any = {}) {
	        return new TemporalPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.date = source["date"];
	        this.n_dates_stack = source["n_dates_stack"];
	        this.soja_ndvi_mean = source["soja_ndvi_mean"];
	        this.soja_retention_pct = source["soja_retention_pct"];
	        this.dominant = source["dominant"];
	    }
	}
	export class PredictResult {
	    extent: Bounds;
	    overlay_uri: string;
	    confidence_uri: string;
	    ndvi_mean_uri: string;
	    true_color_uri: string;
	    reference_uri: string;
	    raster_tif: string;
	    mean_confidence: number;
	    n_dates: number;
	    date_range: string[];
	    class_stats: ClassStat[];
	    temporal: TemporalPoint[];
	    vi_series: VISeriesPoint[];
	    phenology: PhenologyMetrics;
	    phenology_states: PhenologyStatePoint[];
	    lulc?: LULCAnalysis;
	    water?: WaterAnalysis;
	    solar?: SolarAnalysis;
	    solar_terrain?: SolarTerrainAnalysis;
	    solar_siting?: SolarSitingAnalysis;
	
	    static createFrom(source: any = {}) {
	        return new PredictResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.extent = this.convertValues(source["extent"], Bounds);
	        this.overlay_uri = source["overlay_uri"];
	        this.confidence_uri = source["confidence_uri"];
	        this.ndvi_mean_uri = source["ndvi_mean_uri"];
	        this.true_color_uri = source["true_color_uri"];
	        this.reference_uri = source["reference_uri"];
	        this.raster_tif = source["raster_tif"];
	        this.mean_confidence = source["mean_confidence"];
	        this.n_dates = source["n_dates"];
	        this.date_range = source["date_range"];
	        this.class_stats = this.convertValues(source["class_stats"], ClassStat);
	        this.temporal = this.convertValues(source["temporal"], TemporalPoint);
	        this.vi_series = this.convertValues(source["vi_series"], VISeriesPoint);
	        this.phenology = this.convertValues(source["phenology"], PhenologyMetrics);
	        this.phenology_states = this.convertValues(source["phenology_states"], PhenologyStatePoint);
	        this.lulc = this.convertValues(source["lulc"], LULCAnalysis);
	        this.water = this.convertValues(source["water"], WaterAnalysis);
	        this.solar = this.convertValues(source["solar"], SolarAnalysis);
	        this.solar_terrain = this.convertValues(source["solar_terrain"], SolarTerrainAnalysis);
	        this.solar_siting = this.convertValues(source["solar_siting"], SolarSitingAnalysis);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ResearchExportMeta {
	    model_kind: string;
	    area_id: string;
	    aoi_label: string;
	    polygon_geojson: string;
	
	    static createFrom(source: any = {}) {
	        return new ResearchExportMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model_kind = source["model_kind"];
	        this.area_id = source["area_id"];
	        this.aoi_label = source["aoi_label"];
	        this.polygon_geojson = source["polygon_geojson"];
	    }
	}
	
	
	
	
	
	export class SolarRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    climatology_years?: number;
	    hourly_years?: number;
	    surface_azimuth: number;
	    performance_ratio?: number;
	    label?: string;
	    run_label?: string;
	    project_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new SolarRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.climatology_years = source["climatology_years"];
	        this.hourly_years = source["hourly_years"];
	        this.surface_azimuth = source["surface_azimuth"];
	        this.performance_ratio = source["performance_ratio"];
	        this.label = source["label"];
	        this.run_label = source["run_label"];
	        this.project_id = source["project_id"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	export class SolarSitingRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    slope_acceptable_deg?: number;
	    slope_restrictive_deg?: number;
	    excluded_cover?: number[];
	    cropland_cover?: number[];
	
	    static createFrom(source: any = {}) {
	        return new SolarSitingRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.slope_acceptable_deg = source["slope_acceptable_deg"];
	        this.slope_restrictive_deg = source["slope_restrictive_deg"];
	        this.excluded_cover = source["excluded_cover"];
	        this.cropland_cover = source["cropland_cover"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class SolarTerrainRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    hourly_years?: number;
	    season?: string;
	
	    static createFrom(source: any = {}) {
	        return new SolarTerrainRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.hourly_years = source["hourly_years"];
	        this.season = source["season"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	
	export class WaterRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    start: string;
	    end: string;
	    max_cloud: number;
	    monthly_best: boolean;
	    index?: string;
	    label?: string;
	    run_label?: string;
	    project_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new WaterRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.max_cloud = source["max_cloud"];
	        this.monthly_best = source["monthly_best"];
	        this.index = source["index"];
	        this.label = source["label"];
	        this.run_label = source["run_label"];
	        this.project_id = source["project_id"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace main {
	
	export class SaveProjectOverlayRequest {
	    project_id: string;
	    kind: string;
	    title: string;
	    meta_json: string;
	    overlay_uri: string;
	    raster_tif: string;
	
	    static createFrom(source: any = {}) {
	        return new SaveProjectOverlayRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.project_id = source["project_id"];
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.meta_json = source["meta_json"];
	        this.overlay_uri = source["overlay_uri"];
	        this.raster_tif = source["raster_tif"];
	    }
	}

}

export namespace store {
	
	export class InferenceRun {
	    id: string;
	    user_id: string;
	    created_at: string;
	    model_kind: string;
	    period_start: string;
	    period_end: string;
	    polygon_geojson: string;
	    status: string;
	    summary: string;
	    result_json?: string;
	    overlay_relpath?: string;
	    assets_relpath?: string;
	    n_dates: number;
	    label?: string;
	    project_id?: string;
	    kind?: string;
	
	    static createFrom(source: any = {}) {
	        return new InferenceRun(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.user_id = source["user_id"];
	        this.created_at = source["created_at"];
	        this.model_kind = source["model_kind"];
	        this.period_start = source["period_start"];
	        this.period_end = source["period_end"];
	        this.polygon_geojson = source["polygon_geojson"];
	        this.status = source["status"];
	        this.summary = source["summary"];
	        this.result_json = source["result_json"];
	        this.overlay_relpath = source["overlay_relpath"];
	        this.assets_relpath = source["assets_relpath"];
	        this.n_dates = source["n_dates"];
	        this.label = source["label"];
	        this.project_id = source["project_id"];
	        this.kind = source["kind"];
	    }
	}
	export class Preferences {
	    user_id: string;
	    default_model: string;
	    overlay_opacity: number;
	    theme: string;
	    extras_json?: string;
	
	    static createFrom(source: any = {}) {
	        return new Preferences(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user_id = source["user_id"];
	        this.default_model = source["default_model"];
	        this.overlay_opacity = source["overlay_opacity"];
	        this.theme = source["theme"];
	        this.extras_json = source["extras_json"];
	    }
	}
	export class Project {
	    id: string;
	    user_id: string;
	    name: string;
	    notes?: string;
	    created_at: string;
	    updated_at: string;
	    polygon_geojson?: string;
	    area_id?: string;
	    label?: string;
	    run_count?: number;
	    overlay_count?: number;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.user_id = source["user_id"];
	        this.name = source["name"];
	        this.notes = source["notes"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.polygon_geojson = source["polygon_geojson"];
	        this.area_id = source["area_id"];
	        this.label = source["label"];
	        this.run_count = source["run_count"];
	        this.overlay_count = source["overlay_count"];
	    }
	}
	export class ProjectOverlay {
	    id: string;
	    project_id: string;
	    kind: string;
	    title: string;
	    meta_json?: string;
	    png_relpath?: string;
	    tif_relpath?: string;
	    created_at: string;
	    overlay_uri?: string;
	    raster_tif?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProjectOverlay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project_id = source["project_id"];
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.meta_json = source["meta_json"];
	        this.png_relpath = source["png_relpath"];
	        this.tif_relpath = source["tif_relpath"];
	        this.created_at = source["created_at"];
	        this.overlay_uri = source["overlay_uri"];
	        this.raster_tif = source["raster_tif"];
	    }
	}
	export class User {
	    id: string;
	    email: string;
	    display_name: string;
	    avatar_path?: string;
	    avatar_uri?: string;
	    created_at: string;
	    updated_at: string;
	
	    static createFrom(source: any = {}) {
	        return new User(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.email = source["email"];
	        this.display_name = source["display_name"];
	        this.avatar_path = source["avatar_path"];
	        this.avatar_uri = source["avatar_uri"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	    }
	}

}

