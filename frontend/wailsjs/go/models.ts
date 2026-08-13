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
	
	export class DomainFeatureShift {
	    feature: string;
	    z_a: number;
	    z_b: number;
	    gap_sd: number;
	    importance?: number;
	    weighted: number;
	
	    static createFrom(source: any = {}) {
	        return new DomainFeatureShift(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.feature = source["feature"];
	        this.z_a = source["z_a"];
	        this.z_b = source["z_b"];
	        this.gap_sd = source["gap_sd"];
	        this.importance = source["importance"];
	        this.weighted = source["weighted"];
	    }
	}
	export class DomainRedNIR {
	    red_mean: number;
	    nir_mean: number;
	
	    static createFrom(source: any = {}) {
	        return new DomainRedNIR(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.red_mean = source["red_mean"];
	        this.nir_mean = source["nir_mean"];
	    }
	}
	export class DomainHistogram {
	    edges: number[];
	    counts: number[];
	    probs: number[];
	
	    static createFrom(source: any = {}) {
	        return new DomainHistogram(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.edges = source["edges"];
	        this.counts = source["counts"];
	        this.probs = source["probs"];
	    }
	}
	export class DomainFingerprint {
	    space: string;
	    n_features: number;
	    n_pixels: number;
	    n_sample: number;
	    mean: number[];
	    var: number[];
	    z_mean?: number[];
	    z_var?: number[];
	    feature_names?: string[];
	    feature_importances?: number[];
	    ndvi_hist?: DomainHistogram;
	    red_nir?: DomainRedNIR;
	    sample?: number[][];
	
	    static createFrom(source: any = {}) {
	        return new DomainFingerprint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.space = source["space"];
	        this.n_features = source["n_features"];
	        this.n_pixels = source["n_pixels"];
	        this.n_sample = source["n_sample"];
	        this.mean = source["mean"];
	        this.var = source["var"];
	        this.z_mean = source["z_mean"];
	        this.z_var = source["z_var"];
	        this.feature_names = source["feature_names"];
	        this.feature_importances = source["feature_importances"];
	        this.ndvi_hist = this.convertValues(source["ndvi_hist"], DomainHistogram);
	        this.red_nir = this.convertValues(source["red_nir"], DomainRedNIR);
	        this.sample = source["sample"];
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
	
	
	export class DomainShiftClassF1 {
	    index: number;
	    class_id?: number;
	    precision?: number;
	    recall?: number;
	    f1?: number;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftClassF1(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.class_id = source["class_id"];
	        this.precision = source["precision"];
	        this.recall = source["recall"];
	        this.f1 = source["f1"];
	    }
	}
	export class DomainShiftAgreementBlock {
	    label: string;
	    overall_pct?: number;
	    n_outside_legend: number;
	    outside_legend_pct?: number;
	    quantity_disagreement_pct?: number;
	    allocation_disagreement_pct?: number;
	    macro_f1?: number;
	    per_class_f1?: DomainShiftClassF1[];
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftAgreementBlock(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.overall_pct = source["overall_pct"];
	        this.n_outside_legend = source["n_outside_legend"];
	        this.outside_legend_pct = source["outside_legend_pct"];
	        this.quantity_disagreement_pct = source["quantity_disagreement_pct"];
	        this.allocation_disagreement_pct = source["allocation_disagreement_pct"];
	        this.macro_f1 = source["macro_f1"];
	        this.per_class_f1 = this.convertValues(source["per_class_f1"], DomainShiftClassF1);
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
	
	export class DomainShiftMMD {
	    mmd2?: number;
	    gamma?: number;
	    n_a: number;
	    n_b: number;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftMMD(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mmd2 = source["mmd2"];
	        this.gamma = source["gamma"];
	        this.n_a = source["n_a"];
	        this.n_b = source["n_b"];
	    }
	}
	export class DomainShiftCohortRow {
	    id: string;
	    label: string;
	    space_a?: string;
	    space_b?: string;
	    kl_ndvi?: number;
	    kl_ndvi_a_to_b?: number;
	    kl_ndvi_b_to_a?: number;
	    same_space: boolean;
	    standardised: boolean;
	    cva_magnitude?: number;
	    cva_magnitude_sd?: number;
	    cva_angle_red_nir_deg?: number;
	    mmd_rbf?: DomainShiftMMD;
	    comparable: boolean;
	    agreement_a?: DomainShiftAgreementBlock;
	    agreement_b?: DomainShiftAgreementBlock;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftCohortRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.space_a = source["space_a"];
	        this.space_b = source["space_b"];
	        this.kl_ndvi = source["kl_ndvi"];
	        this.kl_ndvi_a_to_b = source["kl_ndvi_a_to_b"];
	        this.kl_ndvi_b_to_a = source["kl_ndvi_b_to_a"];
	        this.same_space = source["same_space"];
	        this.standardised = source["standardised"];
	        this.cva_magnitude = source["cva_magnitude"];
	        this.cva_magnitude_sd = source["cva_magnitude_sd"];
	        this.cva_angle_red_nir_deg = source["cva_angle_red_nir_deg"];
	        this.mmd_rbf = this.convertValues(source["mmd_rbf"], DomainShiftMMD);
	        this.comparable = source["comparable"];
	        this.agreement_a = this.convertValues(source["agreement_a"], DomainShiftAgreementBlock);
	        this.agreement_b = this.convertValues(source["agreement_b"], DomainShiftAgreementBlock);
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
	export class DomainShiftCohortSource {
	    id: string;
	    label: string;
	    space?: string;
	    agreement?: DomainShiftAgreementBlock;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftCohortSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.space = source["space"];
	        this.agreement = this.convertValues(source["agreement"], DomainShiftAgreementBlock);
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
	export class DomainShiftCohort {
	    source: DomainShiftCohortSource;
	    targets: DomainShiftCohortRow[];
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftCohort(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source = this.convertValues(source["source"], DomainShiftCohortSource);
	        this.targets = this.convertValues(source["targets"], DomainShiftCohortRow);
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
	export class DomainShiftCohortSide {
	    id: string;
	    label: string;
	    fingerprint: Record<string, any>;
	    agreement?: Record<string, any>;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftCohortSide(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.fingerprint = source["fingerprint"];
	        this.agreement = source["agreement"];
	    }
	}
	export class DomainShiftCohortRequest {
	    source: DomainShiftCohortSide;
	    targets: DomainShiftCohortSide[];
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftCohortRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source = this.convertValues(source["source"], DomainShiftCohortSide);
	        this.targets = this.convertValues(source["targets"], DomainShiftCohortSide);
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
	
	
	
	
	export class DomainShiftPoint {
	    x: number;
	    y: number;
	    domain: string;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.x = source["x"];
	        this.y = source["y"];
	        this.domain = source["domain"];
	    }
	}
	export class DomainShiftProjection {
	    method: string;
	    points: DomainShiftPoint[];
	    space?: string;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftProjection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.method = source["method"];
	        this.points = this.convertValues(source["points"], DomainShiftPoint);
	        this.space = source["space"];
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
	export class DomainShiftReport {
	    space_a?: string;
	    space_b?: string;
	    kl_ndvi?: number;
	    kl_ndvi_a_to_b?: number;
	    kl_ndvi_b_to_a?: number;
	    same_space: boolean;
	    standardised: boolean;
	    cva_magnitude?: number;
	    cva_magnitude_sd?: number;
	    cva_angle_red_nir_deg?: number;
	    mmd_rbf?: DomainShiftMMD;
	    feature_shift?: DomainFeatureShift[];
	    ndvi_hist_a?: DomainHistogram;
	    ndvi_hist_b?: DomainHistogram;
	    agreement_a?: DomainShiftAgreementBlock;
	    agreement_b?: DomainShiftAgreementBlock;
	    projection?: DomainShiftProjection;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.space_a = source["space_a"];
	        this.space_b = source["space_b"];
	        this.kl_ndvi = source["kl_ndvi"];
	        this.kl_ndvi_a_to_b = source["kl_ndvi_a_to_b"];
	        this.kl_ndvi_b_to_a = source["kl_ndvi_b_to_a"];
	        this.same_space = source["same_space"];
	        this.standardised = source["standardised"];
	        this.cva_magnitude = source["cva_magnitude"];
	        this.cva_magnitude_sd = source["cva_magnitude_sd"];
	        this.cva_angle_red_nir_deg = source["cva_angle_red_nir_deg"];
	        this.mmd_rbf = this.convertValues(source["mmd_rbf"], DomainShiftMMD);
	        this.feature_shift = this.convertValues(source["feature_shift"], DomainFeatureShift);
	        this.ndvi_hist_a = this.convertValues(source["ndvi_hist_a"], DomainHistogram);
	        this.ndvi_hist_b = this.convertValues(source["ndvi_hist_b"], DomainHistogram);
	        this.agreement_a = this.convertValues(source["agreement_a"], DomainShiftAgreementBlock);
	        this.agreement_b = this.convertValues(source["agreement_b"], DomainShiftAgreementBlock);
	        this.projection = this.convertValues(source["projection"], DomainShiftProjection);
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
	export class DomainShiftRequest {
	    fingerprint_a: Record<string, any>;
	    fingerprint_b: Record<string, any>;
	    agreement_a?: Record<string, any>;
	    agreement_b?: Record<string, any>;
	    include_tsne?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new DomainShiftRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fingerprint_a = source["fingerprint_a"];
	        this.fingerprint_b = source["fingerprint_b"];
	        this.agreement_a = source["agreement_a"];
	        this.agreement_b = source["agreement_b"];
	        this.include_tsne = source["include_tsne"];
	    }
	}
	export class EnergyAssumptions {
	    performance_ratio_applied: number;
	    performance_ratio_source: string;
	    performance_ratio_modelled: number;
	    performance_ratio_derived: number;
	    reporting_basis: string;
	    degradation_factor: number;
	    degradation_rate_per_year: number;
	    analysis_period_years: number;
	    module_type: string;
	    transposition_model: string;
	    albedo: number;
	    gcr_fixed: number;
	    gcr_tracker: number;
	    capacity_density_basis: string;
	    capacity_density_mw_dc_per_ha: number;
	    shading_applied: boolean;
	    shading_derate: number;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyAssumptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.performance_ratio_applied = source["performance_ratio_applied"];
	        this.performance_ratio_source = source["performance_ratio_source"];
	        this.performance_ratio_modelled = source["performance_ratio_modelled"];
	        this.performance_ratio_derived = source["performance_ratio_derived"];
	        this.reporting_basis = source["reporting_basis"];
	        this.degradation_factor = source["degradation_factor"];
	        this.degradation_rate_per_year = source["degradation_rate_per_year"];
	        this.analysis_period_years = source["analysis_period_years"];
	        this.module_type = source["module_type"];
	        this.transposition_model = source["transposition_model"];
	        this.albedo = source["albedo"];
	        this.gcr_fixed = source["gcr_fixed"];
	        this.gcr_tracker = source["gcr_tracker"];
	        this.capacity_density_basis = source["capacity_density_basis"];
	        this.capacity_density_mw_dc_per_ha = source["capacity_density_mw_dc_per_ha"];
	        this.shading_applied = source["shading_applied"];
	        this.shading_derate = source["shading_derate"];
	        this.note = source["note"];
	    }
	}
	export class EnergyBolingerDensity {
	    fixed_gwh_ha_year: number;
	    tracking_gwh_ha_year: number;
	    fixed_mwh_acre_year: number;
	    tracking_mwh_acre_year: number;
	    change_pct: number;
	    source: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyBolingerDensity(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fixed_gwh_ha_year = source["fixed_gwh_ha_year"];
	        this.tracking_gwh_ha_year = source["tracking_gwh_ha_year"];
	        this.fixed_mwh_acre_year = source["fixed_mwh_acre_year"];
	        this.tracking_mwh_acre_year = source["tracking_mwh_acre_year"];
	        this.change_pct = source["change_pct"];
	        this.source = source["source"];
	        this.note = source["note"];
	    }
	}
	export class EnergyCapacityDensity {
	    basis: string;
	    value_mw_per_ha: number;
	    units: string;
	    value_mw_dc_per_ha: number;
	    area_basis: string;
	    mounting: string;
	    source: string;
	    acre_conversion: string;
	    buildable_fraction: number;
	    fleet_dc_ac_ratio: number;
	    ac_to_dc_conversion_applied: boolean;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyCapacityDensity(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.basis = source["basis"];
	        this.value_mw_per_ha = source["value_mw_per_ha"];
	        this.units = source["units"];
	        this.value_mw_dc_per_ha = source["value_mw_dc_per_ha"];
	        this.area_basis = source["area_basis"];
	        this.mounting = source["mounting"];
	        this.source = source["source"];
	        this.acre_conversion = source["acre_conversion"];
	        this.buildable_fraction = source["buildable_fraction"];
	        this.fleet_dc_ac_ratio = source["fleet_dc_ac_ratio"];
	        this.ac_to_dc_conversion_applied = source["ac_to_dc_conversion_applied"];
	        this.note = source["note"];
	    }
	}
	export class EnergyContiguity {
	    largest_ha: number;
	    n_patches: number;
	    connectivity: number;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyContiguity(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.largest_ha = source["largest_ha"];
	        this.n_patches = source["n_patches"];
	        this.connectivity = source["connectivity"];
	        this.note = source["note"];
	    }
	}
	export class EnergyDelivered {
	    applied_kwh_kwp_year: number;
	    applied_capacity_factor_pct: number;
	    derived_kwh_kwp_year: number;
	    derived_capacity_factor_pct: number;
	    difference_pct: number;
	    reporting_basis: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyDelivered(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applied_kwh_kwp_year = source["applied_kwh_kwp_year"];
	        this.applied_capacity_factor_pct = source["applied_capacity_factor_pct"];
	        this.derived_kwh_kwp_year = source["derived_kwh_kwp_year"];
	        this.derived_capacity_factor_pct = source["derived_capacity_factor_pct"];
	        this.difference_pct = source["difference_pct"];
	        this.reporting_basis = source["reporting_basis"];
	        this.note = source["note"];
	    }
	}
	export class EnergyDensityCrossCheck {
	    site_mwh_ha_year: number;
	    reference_mwh_ha_year: number;
	    ratio: number;
	    area_basis: string;
	    source: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyDensityCrossCheck(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.site_mwh_ha_year = source["site_mwh_ha_year"];
	        this.reference_mwh_ha_year = source["reference_mwh_ha_year"];
	        this.ratio = source["ratio"];
	        this.area_basis = source["area_basis"];
	        this.source = source["source"];
	        this.note = source["note"];
	    }
	}
	export class EnergyExceedanceCrosswalk {
	    exceedance_p90_kwh_m2_year: number;
	    statistical_p10_kwh_m2_year: number;
	    exceedance_p10_kwh_m2_year: number;
	    statistical_p90_kwh_m2_year: number;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyExceedanceCrosswalk(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.exceedance_p90_kwh_m2_year = source["exceedance_p90_kwh_m2_year"];
	        this.statistical_p10_kwh_m2_year = source["statistical_p10_kwh_m2_year"];
	        this.exceedance_p10_kwh_m2_year = source["exceedance_p10_kwh_m2_year"];
	        this.statistical_p90_kwh_m2_year = source["statistical_p90_kwh_m2_year"];
	        this.note = source["note"];
	    }
	}
	export class EnergyNormality {
	    test: string;
	    statistic: number;
	    p_value: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyNormality(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.test = source["test"];
	        this.statistic = source["statistic"];
	        this.p_value = source["p_value"];
	    }
	}
	export class EnergyExceedanceLevel {
	    level: number;
	    ghi_empirical_kwh_m2_year: number;
	    factor_empirical: number;
	    ghi_normal_kwh_m2_year: number;
	    factor_normal: number;
	    normal_fit_standard_error_kwh_m2: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyExceedanceLevel(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.level = source["level"];
	        this.ghi_empirical_kwh_m2_year = source["ghi_empirical_kwh_m2_year"];
	        this.factor_empirical = source["factor_empirical"];
	        this.ghi_normal_kwh_m2_year = source["ghi_normal_kwh_m2_year"];
	        this.factor_normal = source["factor_normal"];
	        this.normal_fit_standard_error_kwh_m2 = source["normal_fit_standard_error_kwh_m2"];
	    }
	}
	export class EnergyExceedance {
	    method_applied: string;
	    convention: string;
	    convention_note: string;
	    n_years: number;
	    mean_kwh_m2_year: number;
	    std_kwh_m2_year: number;
	    cv_pct: number;
	    levels: EnergyExceedanceLevel[];
	    normality: EnergyNormality;
	    crosswalk: EnergyExceedanceCrosswalk;
	    linearity_assumption: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyExceedance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.method_applied = source["method_applied"];
	        this.convention = source["convention"];
	        this.convention_note = source["convention_note"];
	        this.n_years = source["n_years"];
	        this.mean_kwh_m2_year = source["mean_kwh_m2_year"];
	        this.std_kwh_m2_year = source["std_kwh_m2_year"];
	        this.cv_pct = source["cv_pct"];
	        this.levels = this.convertValues(source["levels"], EnergyExceedanceLevel);
	        this.normality = this.convertValues(source["normality"], EnergyNormality);
	        this.crosswalk = this.convertValues(source["crosswalk"], EnergyExceedanceCrosswalk);
	        this.linearity_assumption = source["linearity_assumption"];
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
	
	export class EnergyExceedanceEnergy {
	    p50_exceedance_gwh_year: number;
	    p75_exceedance_gwh_year: number;
	    p90_exceedance_gwh_year: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyExceedanceEnergy(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.p50_exceedance_gwh_year = source["p50_exceedance_gwh_year"];
	        this.p75_exceedance_gwh_year = source["p75_exceedance_gwh_year"];
	        this.p90_exceedance_gwh_year = source["p90_exceedance_gwh_year"];
	    }
	}
	
	export class EnergyFixedYield {
	    tilt_deg: number;
	    azimuth_deg: number;
	    poa_kwh_m2_year: number;
	    specific_yield_kwh_kwp_year: number;
	    capacity_factor_pct: number;
	    performance_ratio_modelled: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyFixedYield(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.tilt_deg = source["tilt_deg"];
	        this.azimuth_deg = source["azimuth_deg"];
	        this.poa_kwh_m2_year = source["poa_kwh_m2_year"];
	        this.specific_yield_kwh_kwp_year = source["specific_yield_kwh_kwp_year"];
	        this.capacity_factor_pct = source["capacity_factor_pct"];
	        this.performance_ratio_modelled = source["performance_ratio_modelled"];
	    }
	}
	export class EnergyHourlyShareRow {
	    hour: number;
	    share_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyHourlyShareRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hour = source["hour"];
	        this.share_pct = source["share_pct"];
	    }
	}
	export class EnergyHourlyShare {
	    units: string;
	    rows: EnergyHourlyShareRow[];
	
	    static createFrom(source: any = {}) {
	        return new EnergyHourlyShare(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.units = source["units"];
	        this.rows = this.convertValues(source["rows"], EnergyHourlyShareRow);
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
	export class EnergyMonthlyProfileRow {
	    month: number;
	    peak_sun_hours_day: number;
	    poa_kwh_m2_month: number;
	    ac_kwh_kwp_month: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyMonthlyProfileRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.peak_sun_hours_day = source["peak_sun_hours_day"];
	        this.poa_kwh_m2_month = source["poa_kwh_m2_month"];
	        this.ac_kwh_kwp_month = source["ac_kwh_kwp_month"];
	    }
	}
	export class EnergyMonthlyProfile {
	    units: Record<string, string>;
	    rows: EnergyMonthlyProfileRow[];
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyMonthlyProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.units = source["units"];
	        this.rows = this.convertValues(source["rows"], EnergyMonthlyProfileRow);
	        this.note = source["note"];
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
	export class EnergyProfileMonthRow {
	    month: number;
	    mean_ac_w_kwp: number[];
	
	    static createFrom(source: any = {}) {
	        return new EnergyProfileMonthRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.mean_ac_w_kwp = source["mean_ac_w_kwp"];
	    }
	}
	export class EnergyProfileMatrix {
	    units: string;
	    rows: EnergyProfileMonthRow[];
	
	    static createFrom(source: any = {}) {
	        return new EnergyProfileMatrix(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.units = source["units"];
	        this.rows = this.convertValues(source["rows"], EnergyProfileMonthRow);
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
	export class EnergyTimeStandard {
	    source_standard: string;
	    hour_label: string;
	    utc_offset_hours?: number;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyTimeStandard(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source_standard = source["source_standard"];
	        this.hour_label = source["hour_label"];
	        this.utc_offset_hours = source["utc_offset_hours"];
	        this.note = source["note"];
	    }
	}
	export class EnergyGenerationProfile {
	    time_standard: EnergyTimeStandard;
	    mean_ac_power_by_month_and_hour: EnergyProfileMatrix;
	    monthly: EnergyMonthlyProfile;
	    share_of_annual_generation_by_hour: EnergyHourlyShare;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyGenerationProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.time_standard = this.convertValues(source["time_standard"], EnergyTimeStandard);
	        this.mean_ac_power_by_month_and_hour = this.convertValues(source["mean_ac_power_by_month_and_hour"], EnergyProfileMatrix);
	        this.monthly = this.convertValues(source["monthly"], EnergyMonthlyProfile);
	        this.share_of_annual_generation_by_hour = this.convertValues(source["share_of_annual_generation_by_hour"], EnergyHourlyShare);
	        this.note = source["note"];
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
	export class EnergyGeometry {
	    optimal_tilt_deg: number;
	    surface_azimuth_deg: number;
	    poa_kwh_m2_year: number;
	    poa_horizontal_kwh_m2_year: number;
	    ghi_hourly_kwh_m2_year: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyGeometry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.optimal_tilt_deg = source["optimal_tilt_deg"];
	        this.surface_azimuth_deg = source["surface_azimuth_deg"];
	        this.poa_kwh_m2_year = source["poa_kwh_m2_year"];
	        this.poa_horizontal_kwh_m2_year = source["poa_horizontal_kwh_m2_year"];
	        this.ghi_hourly_kwh_m2_year = source["ghi_hourly_kwh_m2_year"];
	    }
	}
	
	
	export class EnergyLossTerm {
	    key: string;
	    label: string;
	    loss_pct: number;
	    factor: number;
	    kind: string;
	    source: string;
	    user_editable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EnergyLossTerm(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.loss_pct = source["loss_pct"];
	        this.factor = source["factor"];
	        this.kind = source["kind"];
	        this.source = source["source"];
	        this.user_editable = source["user_editable"];
	    }
	}
	export class EnergyTextSource {
	    value: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyTextSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.value = source["value"];
	        this.source = source["source"];
	    }
	}
	export class EnergyNumberSource {
	    value: number;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyNumberSource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.value = source["value"];
	        this.source = source["source"];
	    }
	}
	export class EnergyModuleType {
	    gamma_pdc_per_c: number;
	    module_type: string;
	    alternatives: Record<string, number>;
	    source: string;
	    user_editable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EnergyModuleType(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.gamma_pdc_per_c = source["gamma_pdc_per_c"];
	        this.module_type = source["module_type"];
	        this.alternatives = source["alternatives"];
	        this.source = source["source"];
	        this.user_editable = source["user_editable"];
	    }
	}
	export class EnergyWaterfallAssumptions {
	    module_type: EnergyModuleType;
	    albedo: EnergyNumberSource;
	    transposition_model: EnergyTextSource;
	    wind_source: EnergyTextSource;
	    flat_placement_bias_pct: EnergyNumberSource;
	
	    static createFrom(source: any = {}) {
	        return new EnergyWaterfallAssumptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.module_type = this.convertValues(source["module_type"], EnergyModuleType);
	        this.albedo = this.convertValues(source["albedo"], EnergyNumberSource);
	        this.transposition_model = this.convertValues(source["transposition_model"], EnergyTextSource);
	        this.wind_source = this.convertValues(source["wind_source"], EnergyTextSource);
	        this.flat_placement_bias_pct = this.convertValues(source["flat_placement_bias_pct"], EnergyNumberSource);
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
	export class EnergyWaterfallPR {
	    applied: number;
	    applied_source: string;
	    modelled: number;
	    derived: number;
	    reporting_basis: string;
	    degradation_factor: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyWaterfallPR(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applied = source["applied"];
	        this.applied_source = source["applied_source"];
	        this.modelled = source["modelled"];
	        this.derived = source["derived"];
	        this.reporting_basis = source["reporting_basis"];
	        this.degradation_factor = source["degradation_factor"];
	    }
	}
	export class EnergyWaterfallCheckpoint {
	    name: string;
	    value: number;
	    residual?: number;
	    note: string;
	    external_band: number[];
	
	    static createFrom(source: any = {}) {
	        return new EnergyWaterfallCheckpoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.value = source["value"];
	        this.residual = source["residual"];
	        this.note = source["note"];
	        this.external_band = source["external_band"];
	    }
	}
	export class EnergyWaterfallStep {
	    step: number;
	    label: string;
	    factor?: number;
	    energy_after: number;
	    units: string;
	    cumulative_ratio?: number;
	    kind: string;
	    in_performance_ratio: boolean;
	    source: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyWaterfallStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.step = source["step"];
	        this.label = source["label"];
	        this.factor = source["factor"];
	        this.energy_after = source["energy_after"];
	        this.units = source["units"];
	        this.cumulative_ratio = source["cumulative_ratio"];
	        this.kind = source["kind"];
	        this.in_performance_ratio = source["in_performance_ratio"];
	        this.source = source["source"];
	        this.note = source["note"];
	    }
	}
	export class EnergyWaterfallBase {
	    ghi_hourly_kwh_m2_year: number;
	    hourly_window: string;
	    ghi_climatology_kwh_m2_year: number;
	    climatology_window: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyWaterfallBase(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ghi_hourly_kwh_m2_year = source["ghi_hourly_kwh_m2_year"];
	        this.hourly_window = source["hourly_window"];
	        this.ghi_climatology_kwh_m2_year = source["ghi_climatology_kwh_m2_year"];
	        this.climatology_window = source["climatology_window"];
	        this.note = source["note"];
	    }
	}
	export class EnergyLossWaterfall {
	    base: EnergyWaterfallBase;
	    steps: EnergyWaterfallStep[];
	    checkpoints: EnergyWaterfallCheckpoint[];
	    outside_performance_ratio: string[];
	    performance_ratio: EnergyWaterfallPR;
	    delivered: EnergyDelivered;
	    assumptions: EnergyWaterfallAssumptions;
	
	    static createFrom(source: any = {}) {
	        return new EnergyLossWaterfall(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.base = this.convertValues(source["base"], EnergyWaterfallBase);
	        this.steps = this.convertValues(source["steps"], EnergyWaterfallStep);
	        this.checkpoints = this.convertValues(source["checkpoints"], EnergyWaterfallCheckpoint);
	        this.outside_performance_ratio = source["outside_performance_ratio"];
	        this.performance_ratio = this.convertValues(source["performance_ratio"], EnergyWaterfallPR);
	        this.delivered = this.convertValues(source["delivered"], EnergyDelivered);
	        this.assumptions = this.convertValues(source["assumptions"], EnergyWaterfallAssumptions);
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
	export class PowerSeriesProvenance {
	    source: string;
	    fetched_utc?: string;
	    product: string;
	    cell_key: string;
	    period: string;
	    cache_file?: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new PowerSeriesProvenance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.source = source["source"];
	        this.fetched_utc = source["fetched_utc"];
	        this.product = source["product"];
	        this.cell_key = source["cell_key"];
	        this.period = source["period"];
	        this.cache_file = source["cache_file"];
	        this.note = source["note"];
	    }
	}
	export class PowerProvenance {
	    daily?: PowerSeriesProvenance;
	    hourly?: PowerSeriesProvenance;
	
	    static createFrom(source: any = {}) {
	        return new PowerProvenance(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.daily = this.convertValues(source["daily"], PowerSeriesProvenance);
	        this.hourly = this.convertValues(source["hourly"], PowerSeriesProvenance);
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
	export class EnergyUncertainty {
	    included: string[];
	    excluded: string[];
	    statement: string;
	    dominant_term: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyUncertainty(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.included = source["included"];
	        this.excluded = source["excluded"];
	        this.statement = source["statement"];
	        this.dominant_term = source["dominant_term"];
	    }
	}
	export class EnergyShading {
	    derate: number;
	    applied: boolean;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyShading(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.derate = source["derate"];
	        this.applied = source["applied"];
	        this.note = source["note"];
	    }
	}
	export class EnergyRestrictiveClass {
	    label: string;
	    area_ha: number;
	    capacity_dc_mw?: number;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyRestrictiveClass(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.area_ha = source["area_ha"];
	        this.capacity_dc_mw = source["capacity_dc_mw"];
	        this.note = source["note"];
	    }
	}
	export class EnergyPlantClass {
	    label: string;
	    area_ha: number;
	    capacity_dc_mw: number;
	    capacity_ac_mw: number;
	    specific_yield_kwh_kwp_year: number;
	    energy: EnergyExceedanceEnergy;
	    reporting_basis: string;
	    performance_ratio: number;
	    performance_ratio_source: string;
	    note: string;
	    contiguity: EnergyContiguity;
	
	    static createFrom(source: any = {}) {
	        return new EnergyPlantClass(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.area_ha = source["area_ha"];
	        this.capacity_dc_mw = source["capacity_dc_mw"];
	        this.capacity_ac_mw = source["capacity_ac_mw"];
	        this.specific_yield_kwh_kwp_year = source["specific_yield_kwh_kwp_year"];
	        this.energy = this.convertValues(source["energy"], EnergyExceedanceEnergy);
	        this.reporting_basis = source["reporting_basis"];
	        this.performance_ratio = source["performance_ratio"];
	        this.performance_ratio_source = source["performance_ratio_source"];
	        this.note = source["note"];
	        this.contiguity = this.convertValues(source["contiguity"], EnergyContiguity);
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
	export class EnergyPlant {
	    suitable: EnergyPlantClass;
	    cropland_conflict: EnergyPlantClass;
	    restrictive: EnergyRestrictiveClass;
	    areas_note: string;
	    capacity_density: EnergyCapacityDensity;
	    shading: EnergyShading;
	    exceedance: EnergyExceedance;
	    uncertainty: EnergyUncertainty;
	    energy_density_cross_check: EnergyDensityCrossCheck;
	    reporting_basis: string;
	    limitations: string;
	    thresholds: SolarSitingThresholds;
	
	    static createFrom(source: any = {}) {
	        return new EnergyPlant(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.suitable = this.convertValues(source["suitable"], EnergyPlantClass);
	        this.cropland_conflict = this.convertValues(source["cropland_conflict"], EnergyPlantClass);
	        this.restrictive = this.convertValues(source["restrictive"], EnergyRestrictiveClass);
	        this.areas_note = source["areas_note"];
	        this.capacity_density = this.convertValues(source["capacity_density"], EnergyCapacityDensity);
	        this.shading = this.convertValues(source["shading"], EnergyShading);
	        this.exceedance = this.convertValues(source["exceedance"], EnergyExceedance);
	        this.uncertainty = this.convertValues(source["uncertainty"], EnergyUncertainty);
	        this.energy_density_cross_check = this.convertValues(source["energy_density_cross_check"], EnergyDensityCrossCheck);
	        this.reporting_basis = source["reporting_basis"];
	        this.limitations = source["limitations"];
	        this.thresholds = this.convertValues(source["thresholds"], SolarSitingThresholds);
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
	export class EnergyPRTransfer {
	    wind: string;
	    performance_ratio_fixed: number;
	    performance_ratio_tracker: number;
	    difference_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyPRTransfer(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.wind = source["wind"];
	        this.performance_ratio_fixed = source["performance_ratio_fixed"];
	        this.performance_ratio_tracker = source["performance_ratio_tracker"];
	        this.difference_pct = source["difference_pct"];
	    }
	}
	export class EnergyTrackingPR {
	    applied: number;
	    applied_source: string;
	    reporting_basis: string;
	    transfer_between_configurations: EnergyPRTransfer[];
	    transfer_range_pct: number[];
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyTrackingPR(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applied = source["applied"];
	        this.applied_source = source["applied_source"];
	        this.reporting_basis = source["reporting_basis"];
	        this.transfer_between_configurations = this.convertValues(source["transfer_between_configurations"], EnergyPRTransfer);
	        this.transfer_range_pct = source["transfer_range_pct"];
	        this.note = source["note"];
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
	export class EnergyParityGCR {
	    gcr_tracker: number;
	    gcr_ratio: number;
	    search_range: number[];
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyParityGCR(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.gcr_tracker = source["gcr_tracker"];
	        this.gcr_ratio = source["gcr_ratio"];
	        this.search_range = source["search_range"];
	        this.note = source["note"];
	    }
	}
	export class EnergyModelDerivedLandUse {
	    energy_per_hectare_ratio: number;
	    change_pct: number;
	    gcr_fixed: number;
	    gcr_tracker: number;
	    gcr_ratio: number;
	    basis: string;
	    note: string;
	    parity: EnergyParityGCR;
	
	    static createFrom(source: any = {}) {
	        return new EnergyModelDerivedLandUse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.energy_per_hectare_ratio = source["energy_per_hectare_ratio"];
	        this.change_pct = source["change_pct"];
	        this.gcr_fixed = source["gcr_fixed"];
	        this.gcr_tracker = source["gcr_tracker"];
	        this.gcr_ratio = source["gcr_ratio"];
	        this.basis = source["basis"];
	        this.note = source["note"];
	        this.parity = this.convertValues(source["parity"], EnergyParityGCR);
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
	export class EnergyOngRow {
	    site: string;
	    dni_kwh_m2_year: number;
	    land_use_change_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyOngRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.site = source["site"];
	        this.dni_kwh_m2_year = source["dni_kwh_m2_year"];
	        this.land_use_change_pct = source["land_use_change_pct"];
	    }
	}
	export class EnergyOngTable5 {
	    site_dni_kwh_m2_year: number;
	    nearest_rows: EnergyOngRow[];
	    band_pct: number[];
	    source: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyOngTable5(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.site_dni_kwh_m2_year = source["site_dni_kwh_m2_year"];
	        this.nearest_rows = this.convertValues(source["nearest_rows"], EnergyOngRow);
	        this.band_pct = source["band_pct"];
	        this.source = source["source"];
	        this.note = source["note"];
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
	export class EnergyPublishedLandUse {
	    bolinger_2022: EnergyBolingerDensity;
	    ong_2013_table5: EnergyOngTable5;
	    disagreement: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyPublishedLandUse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.bolinger_2022 = this.convertValues(source["bolinger_2022"], EnergyBolingerDensity);
	        this.ong_2013_table5 = this.convertValues(source["ong_2013_table5"], EnergyOngTable5);
	        this.disagreement = source["disagreement"];
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
	export class EnergyPerHectare {
	    published_measurements: EnergyPublishedLandUse;
	    model_derived: EnergyModelDerivedLandUse;
	    inverts: boolean;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyPerHectare(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.published_measurements = this.convertValues(source["published_measurements"], EnergyPublishedLandUse);
	        this.model_derived = this.convertValues(source["model_derived"], EnergyModelDerivedLandUse);
	        this.inverts = source["inverts"];
	        this.note = source["note"];
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
	export class EnergySeasonRow {
	    season: string;
	    months: number[];
	    fixed_poa_kwh_m2_season: number;
	    tracker_poa_kwh_m2_season: number;
	    gain_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergySeasonRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.season = source["season"];
	        this.months = source["months"];
	        this.fixed_poa_kwh_m2_season = source["fixed_poa_kwh_m2_season"];
	        this.tracker_poa_kwh_m2_season = source["tracker_poa_kwh_m2_season"];
	        this.gain_pct = source["gain_pct"];
	    }
	}
	export class EnergySeasonal {
	    rows: EnergySeasonRow[];
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergySeasonal(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rows = this.convertValues(source["rows"], EnergySeasonRow);
	        this.note = source["note"];
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
	export class EnergyTrackerYield {
	    gcr: number;
	    poa_kwh_m2_year: number;
	    specific_yield_kwh_kwp_year: number;
	    capacity_factor_pct: number;
	    performance_ratio_modelled: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyTrackerYield(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.gcr = source["gcr"];
	        this.poa_kwh_m2_year = source["poa_kwh_m2_year"];
	        this.specific_yield_kwh_kwp_year = source["specific_yield_kwh_kwp_year"];
	        this.capacity_factor_pct = source["capacity_factor_pct"];
	        this.performance_ratio_modelled = source["performance_ratio_modelled"];
	    }
	}
	export class EnergyPerKWp {
	    fixed: EnergyFixedYield;
	    tracking: EnergyTrackerYield;
	    gain_pct: number;
	    inverts: boolean;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyPerKWp(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.fixed = this.convertValues(source["fixed"], EnergyFixedYield);
	        this.tracking = this.convertValues(source["tracking"], EnergyTrackerYield);
	        this.gain_pct = source["gain_pct"];
	        this.inverts = source["inverts"];
	        this.note = source["note"];
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
	export class EnergyTrackerConfiguration {
	    axis_tilt_deg: number;
	    axis_azimuth_deg: number;
	    axis_azimuth_convention: string;
	    max_angle_deg: number;
	    backtrack: boolean;
	    terrain: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyTrackerConfiguration(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.axis_tilt_deg = source["axis_tilt_deg"];
	        this.axis_azimuth_deg = source["axis_azimuth_deg"];
	        this.axis_azimuth_convention = source["axis_azimuth_convention"];
	        this.max_angle_deg = source["max_angle_deg"];
	        this.backtrack = source["backtrack"];
	        this.terrain = source["terrain"];
	    }
	}
	export class EnergyTracking {
	    configuration: EnergyTrackerConfiguration;
	    per_kwp: EnergyPerKWp;
	    seasonal: EnergySeasonal;
	    per_hectare: EnergyPerHectare;
	    performance_ratio: EnergyTrackingPR;
	    excluded: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyTracking(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.configuration = this.convertValues(source["configuration"], EnergyTrackerConfiguration);
	        this.per_kwp = this.convertValues(source["per_kwp"], EnergyPerKWp);
	        this.seasonal = this.convertValues(source["seasonal"], EnergySeasonal);
	        this.per_hectare = this.convertValues(source["per_hectare"], EnergyPerHectare);
	        this.performance_ratio = this.convertValues(source["performance_ratio"], EnergyTrackingPR);
	        this.excluded = source["excluded"];
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
	export class EnergyOptionalLossTerm {
	    key: string;
	    label: string;
	    loss_pct: number;
	    factor: number;
	    kind: string;
	    default_pct: number;
	    pvwatts_suggested_pct: number;
	    source: string;
	    user_editable: boolean;
	
	    static createFrom(source: any = {}) {
	        return new EnergyOptionalLossTerm(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.loss_pct = source["loss_pct"];
	        this.factor = source["factor"];
	        this.kind = source["kind"];
	        this.default_pct = source["default_pct"];
	        this.pvwatts_suggested_pct = source["pvwatts_suggested_pct"];
	        this.source = source["source"];
	        this.user_editable = source["user_editable"];
	    }
	}
	export class EnergyPRFactors {
	    energy_poa_kwh_m2_year: number;
	    energy_effective_kwh_m2_year: number;
	    energy_dc_kwh_kwp_year: number;
	    energy_ac_kwh_kwp_year: number;
	    f_iam: number;
	    f_temp: number;
	    f_inverter: number;
	    performance_ratio_modelled: number;
	    telescoping_residual: number;
	    temp_cell_irradiance_weighted_c: number;
	
	    static createFrom(source: any = {}) {
	        return new EnergyPRFactors(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.energy_poa_kwh_m2_year = source["energy_poa_kwh_m2_year"];
	        this.energy_effective_kwh_m2_year = source["energy_effective_kwh_m2_year"];
	        this.energy_dc_kwh_kwp_year = source["energy_dc_kwh_kwp_year"];
	        this.energy_ac_kwh_kwp_year = source["energy_ac_kwh_kwp_year"];
	        this.f_iam = source["f_iam"];
	        this.f_temp = source["f_temp"];
	        this.f_inverter = source["f_inverter"];
	        this.performance_ratio_modelled = source["performance_ratio_modelled"];
	        this.telescoping_residual = source["telescoping_residual"];
	        this.temp_cell_irradiance_weighted_c = source["temp_cell_irradiance_weighted_c"];
	    }
	}
	export class EnergyPerformanceRatio {
	    applied: number;
	    applied_source: string;
	    reference: number;
	    modelled: number;
	    derived: number;
	    derived_if_optional_at_pvwatts_defaults: number;
	    declared_loss_factor: number;
	    optional_loss_factor: number;
	    factors: EnergyPRFactors;
	    declared_losses: EnergyLossTerm[];
	    optional_losses: EnergyOptionalLossTerm[];
	    reporting_basis: string;
	    degradation_factor: number;
	    degradation_rate_per_year: number;
	    analysis_period_years: number;
	    gsa_implied_band: number[];
	
	    static createFrom(source: any = {}) {
	        return new EnergyPerformanceRatio(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applied = source["applied"];
	        this.applied_source = source["applied_source"];
	        this.reference = source["reference"];
	        this.modelled = source["modelled"];
	        this.derived = source["derived"];
	        this.derived_if_optional_at_pvwatts_defaults = source["derived_if_optional_at_pvwatts_defaults"];
	        this.declared_loss_factor = source["declared_loss_factor"];
	        this.optional_loss_factor = source["optional_loss_factor"];
	        this.factors = this.convertValues(source["factors"], EnergyPRFactors);
	        this.declared_losses = this.convertValues(source["declared_losses"], EnergyLossTerm);
	        this.optional_losses = this.convertValues(source["optional_losses"], EnergyOptionalLossTerm);
	        this.reporting_basis = source["reporting_basis"];
	        this.degradation_factor = source["degradation_factor"];
	        this.degradation_rate_per_year = source["degradation_rate_per_year"];
	        this.analysis_period_years = source["analysis_period_years"];
	        this.gsa_implied_band = source["gsa_implied_band"];
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
	export class EnergyModelAnalysis {
	    lon: number;
	    lat: number;
	    hourly_years: number;
	    climatology_years: number;
	    hourly_window: string;
	    climatology_window: string;
	    geometry: EnergyGeometry;
	    performance_ratio: EnergyPerformanceRatio;
	    module_type: EnergyModuleType;
	    loss_waterfall: EnergyLossWaterfall;
	    tracking: EnergyTracking;
	    generation_profile: EnergyGenerationProfile;
	    capacity_density: EnergyCapacityDensity;
	    plant: EnergyPlant;
	    reporting_basis: string;
	    grid_note: string;
	    assumptions: EnergyAssumptions;
	    power_provenance?: PowerProvenance;
	
	    static createFrom(source: any = {}) {
	        return new EnergyModelAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.hourly_years = source["hourly_years"];
	        this.climatology_years = source["climatology_years"];
	        this.hourly_window = source["hourly_window"];
	        this.climatology_window = source["climatology_window"];
	        this.geometry = this.convertValues(source["geometry"], EnergyGeometry);
	        this.performance_ratio = this.convertValues(source["performance_ratio"], EnergyPerformanceRatio);
	        this.module_type = this.convertValues(source["module_type"], EnergyModuleType);
	        this.loss_waterfall = this.convertValues(source["loss_waterfall"], EnergyLossWaterfall);
	        this.tracking = this.convertValues(source["tracking"], EnergyTracking);
	        this.generation_profile = this.convertValues(source["generation_profile"], EnergyGenerationProfile);
	        this.capacity_density = this.convertValues(source["capacity_density"], EnergyCapacityDensity);
	        this.plant = this.convertValues(source["plant"], EnergyPlant);
	        this.reporting_basis = source["reporting_basis"];
	        this.grid_note = source["grid_note"];
	        this.assumptions = this.convertValues(source["assumptions"], EnergyAssumptions);
	        this.power_provenance = this.convertValues(source["power_provenance"], PowerProvenance);
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
	
	export class EnergyModelRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    climatology_years?: number;
	    hourly_years?: number;
	    surface_azimuth: number;
	    performance_ratio?: number;
	    reporting_basis?: string;
	    degradation_rate_per_year?: number;
	    analysis_period_years?: number;
	    declared_loss_pct?: Record<string, number>;
	    optional_loss_pct?: Record<string, number>;
	    gcr_fixed?: number;
	    gcr_tracker?: number;
	    tracker_max_angle_deg?: number;
	    capacity_density_basis?: string;
	    buildable_fraction?: number;
	    utc_offset_hours?: number;
	    slope_acceptable_deg?: number;
	    slope_restrictive_deg?: number;
	    excluded_cover?: number[];
	    cropland_cover?: number[];
	    siting_raster_tif?: string;
	    shading_derate?: number;
	    shading_applied?: boolean;
	    label?: string;
	    run_label?: string;
	    project_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new EnergyModelRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.climatology_years = source["climatology_years"];
	        this.hourly_years = source["hourly_years"];
	        this.surface_azimuth = source["surface_azimuth"];
	        this.performance_ratio = source["performance_ratio"];
	        this.reporting_basis = source["reporting_basis"];
	        this.degradation_rate_per_year = source["degradation_rate_per_year"];
	        this.analysis_period_years = source["analysis_period_years"];
	        this.declared_loss_pct = source["declared_loss_pct"];
	        this.optional_loss_pct = source["optional_loss_pct"];
	        this.gcr_fixed = source["gcr_fixed"];
	        this.gcr_tracker = source["gcr_tracker"];
	        this.tracker_max_angle_deg = source["tracker_max_angle_deg"];
	        this.capacity_density_basis = source["capacity_density_basis"];
	        this.buildable_fraction = source["buildable_fraction"];
	        this.utc_offset_hours = source["utc_offset_hours"];
	        this.slope_acceptable_deg = source["slope_acceptable_deg"];
	        this.slope_restrictive_deg = source["slope_restrictive_deg"];
	        this.excluded_cover = source["excluded_cover"];
	        this.cropland_cover = source["cropland_cover"];
	        this.siting_raster_tif = source["siting_raster_tif"];
	        this.shading_derate = source["shading_derate"];
	        this.shading_applied = source["shading_applied"];
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
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	
	export class EnvPackage {
	    module: string;
	    distribution: string;
	    blocks: string;
	    optional: boolean;
	    present: boolean;
	    version: string;
	    wanted: string;
	    version_problem: string;
	    why: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new EnvPackage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.module = source["module"];
	        this.distribution = source["distribution"];
	        this.blocks = source["blocks"];
	        this.optional = source["optional"];
	        this.present = source["present"];
	        this.version = source["version"];
	        this.wanted = source["wanted"];
	        this.version_problem = source["version_problem"];
	        this.why = source["why"];
	        this.error = source["error"];
	    }
	}
	export class EnvReport {
	    executable: string;
	    python_version: string;
	    python_ok: boolean;
	    min_python: string;
	    packages: EnvPackage[];
	    usable: boolean;
	    origin: string;
	    unreachable: string;
	
	    static createFrom(source: any = {}) {
	        return new EnvReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.executable = source["executable"];
	        this.python_version = source["python_version"];
	        this.python_ok = source["python_ok"];
	        this.min_python = source["min_python"];
	        this.packages = this.convertValues(source["packages"], EnvPackage);
	        this.usable = source["usable"];
	        this.origin = source["origin"];
	        this.unreachable = source["unreachable"];
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
	export class LULCAgreementBlock {
	    row: number;
	    col: number;
	    n_reference_cells: number;
	    overall_pct?: number;
	
	    static createFrom(source: any = {}) {
	        return new LULCAgreementBlock(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.row = source["row"];
	        this.col = source["col"];
	        this.n_reference_cells = source["n_reference_cells"];
	        this.overall_pct = source["overall_pct"];
	    }
	}
	export class LULCAgreementBlocks {
	    rows: number;
	    cols: number;
	    min_cells: number;
	    cells: LULCAgreementBlock[];
	    n_measured: number;
	    median_pct: number;
	    iqr_pct: number;
	    min_pct: number;
	    max_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new LULCAgreementBlocks(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rows = source["rows"];
	        this.cols = source["cols"];
	        this.min_cells = source["min_cells"];
	        this.cells = this.convertValues(source["cells"], LULCAgreementBlock);
	        this.n_measured = source["n_measured"];
	        this.median_pct = source["median_pct"];
	        this.iqr_pct = source["iqr_pct"];
	        this.min_pct = source["min_pct"];
	        this.max_pct = source["max_pct"];
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
	export class LULCClassAccuracy {
	    class_id: number;
	    name: string;
	    color: string;
	    producers_pct?: number;
	    producers_ci?: number[];
	    users_pct?: number;
	    users_ci?: number[];
	    n_reference: number;
	    n_predicted: number;
	
	    static createFrom(source: any = {}) {
	        return new LULCClassAccuracy(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.class_id = source["class_id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.producers_pct = source["producers_pct"];
	        this.producers_ci = source["producers_ci"];
	        this.users_pct = source["users_pct"];
	        this.users_ci = source["users_ci"];
	        this.n_reference = source["n_reference"];
	        this.n_predicted = source["n_predicted"];
	    }
	}
	export class LULCAgreement {
	    n_reference_cells: number;
	    overall_pct: number;
	    overall_ci: number[];
	    quantity_disagreement_pct: number;
	    allocation_disagreement_pct: number;
	    per_class: LULCClassAccuracy[];
	    n_outside_legend: number;
	    matrix: number[][];
	    matrix_classes: number[];
	    blocks?: LULCAgreementBlocks;
	
	    static createFrom(source: any = {}) {
	        return new LULCAgreement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.n_reference_cells = source["n_reference_cells"];
	        this.overall_pct = source["overall_pct"];
	        this.overall_ci = source["overall_ci"];
	        this.quantity_disagreement_pct = source["quantity_disagreement_pct"];
	        this.allocation_disagreement_pct = source["allocation_disagreement_pct"];
	        this.per_class = this.convertValues(source["per_class"], LULCClassAccuracy);
	        this.n_outside_legend = source["n_outside_legend"];
	        this.matrix = source["matrix"];
	        this.matrix_classes = source["matrix_classes"];
	        this.blocks = this.convertValues(source["blocks"], LULCAgreementBlocks);
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
	    agreement?: LULCAgreement;
	
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
	        this.agreement = this.convertValues(source["agreement"], LULCAgreement);
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
	export class WindAssumptions {
	    hub_height_m: number;
	    hub_height_source: string;
	    record_years: number;
	    record_window: string;
	    shear_exponent: number;
	    shear_exponent_source: string;
	    roughness_band_m: number[];
	    calm_threshold_ms: number;
	    record_max_floor_ms: number;
	    qualifier: string;
	    excluded_losses: string[];
	    comparison_note: string;
	
	    static createFrom(source: any = {}) {
	        return new WindAssumptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hub_height_m = source["hub_height_m"];
	        this.hub_height_source = source["hub_height_source"];
	        this.record_years = source["record_years"];
	        this.record_window = source["record_window"];
	        this.shear_exponent = source["shear_exponent"];
	        this.shear_exponent_source = source["shear_exponent_source"];
	        this.roughness_band_m = source["roughness_band_m"];
	        this.calm_threshold_ms = source["calm_threshold_ms"];
	        this.record_max_floor_ms = source["record_max_floor_ms"];
	        this.qualifier = source["qualifier"];
	        this.excluded_losses = source["excluded_losses"];
	        this.comparison_note = source["comparison_note"];
	    }
	}
	export class WindTurbine {
	    name: string;
	    rated_power_w: number;
	    rotor_diameter_m: number;
	    hub_height_m: number;
	    blades: number;
	    iec_class: string;
	    turbulence_class: string;
	    cut_in_ms: number;
	    rated_speed_ms: number;
	    cut_out_ms: number;
	    power_curve_points: number;
	    power_curve_column: string;
	    citation: string;
	    citation_url: string;
	    curve_source_url: string;
	    curve_source_commit: string;
	
	    static createFrom(source: any = {}) {
	        return new WindTurbine(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.rated_power_w = source["rated_power_w"];
	        this.rotor_diameter_m = source["rotor_diameter_m"];
	        this.hub_height_m = source["hub_height_m"];
	        this.blades = source["blades"];
	        this.iec_class = source["iec_class"];
	        this.turbulence_class = source["turbulence_class"];
	        this.cut_in_ms = source["cut_in_ms"];
	        this.rated_speed_ms = source["rated_speed_ms"];
	        this.cut_out_ms = source["cut_out_ms"];
	        this.power_curve_points = source["power_curve_points"];
	        this.power_curve_column = source["power_curve_column"];
	        this.citation = source["citation"];
	        this.citation_url = source["citation_url"];
	        this.curve_source_url = source["curve_source_url"];
	        this.curve_source_commit = source["curve_source_commit"];
	    }
	}
	export class WindShearDiagnostics {
	    shear_exponent: number;
	    implied_roughness_length_m?: number;
	    assumed_roughness_band_m: number[];
	    expected_shear_exponent_band: number[];
	    consistent_with_assumed_cover: boolean;
	    shear_exponent_hourly_mean: number;
	    shear_exponent_hourly_median: number;
	    shear_exponent_day: number;
	    shear_exponent_night: number;
	    local_utc_offset_hours: number;
	
	    static createFrom(source: any = {}) {
	        return new WindShearDiagnostics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shear_exponent = source["shear_exponent"];
	        this.implied_roughness_length_m = source["implied_roughness_length_m"];
	        this.assumed_roughness_band_m = source["assumed_roughness_band_m"];
	        this.expected_shear_exponent_band = source["expected_shear_exponent_band"];
	        this.consistent_with_assumed_cover = source["consistent_with_assumed_cover"];
	        this.shear_exponent_hourly_mean = source["shear_exponent_hourly_mean"];
	        this.shear_exponent_hourly_median = source["shear_exponent_hourly_median"];
	        this.shear_exponent_day = source["shear_exponent_day"];
	        this.shear_exponent_night = source["shear_exponent_night"];
	        this.local_utc_offset_hours = source["local_utc_offset_hours"];
	    }
	}
	export class WindDataQuality {
	    record_hours: number;
	    expected_hours: number;
	    mean_speed_ms: Record<string, number>;
	    calm_fraction_pct: Record<string, number>;
	    calm_threshold_ms: number;
	    record_maximum_ms: Record<string, number>;
	    record_maximum_floor_ms: number;
	    record_maximum_plausible: boolean;
	    calm_fraction_2m_flag_pct: number;
	    nan_count: Record<string, number>;
	    shear: WindShearDiagnostics;
	    flags: string[];
	    all_checks_passed: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WindDataQuality(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.record_hours = source["record_hours"];
	        this.expected_hours = source["expected_hours"];
	        this.mean_speed_ms = source["mean_speed_ms"];
	        this.calm_fraction_pct = source["calm_fraction_pct"];
	        this.calm_threshold_ms = source["calm_threshold_ms"];
	        this.record_maximum_ms = source["record_maximum_ms"];
	        this.record_maximum_floor_ms = source["record_maximum_floor_ms"];
	        this.record_maximum_plausible = source["record_maximum_plausible"];
	        this.calm_fraction_2m_flag_pct = source["calm_fraction_2m_flag_pct"];
	        this.nan_count = source["nan_count"];
	        this.shear = this.convertValues(source["shear"], WindShearDiagnostics);
	        this.flags = source["flags"];
	        this.all_checks_passed = source["all_checks_passed"];
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
	export class WindShearRow {
	    shear_exponent: number;
	    roughness_length_m?: number;
	    basis: string;
	    hub_speed_ms: number;
	    capacity_factor_pct: number;
	    annual_energy_mwh: number;
	
	    static createFrom(source: any = {}) {
	        return new WindShearRow(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.shear_exponent = source["shear_exponent"];
	        this.roughness_length_m = source["roughness_length_m"];
	        this.basis = source["basis"];
	        this.hub_speed_ms = source["hub_speed_ms"];
	        this.capacity_factor_pct = source["capacity_factor_pct"];
	        this.annual_energy_mwh = source["annual_energy_mwh"];
	    }
	}
	export class WindOperatingRegime {
	    above_cut_in_pct: number;
	    at_or_above_rated_pct: number;
	    above_cut_out_pct: number;
	    cut_in_ms: number;
	    rated_ms: number;
	    cut_out_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new WindOperatingRegime(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.above_cut_in_pct = source["above_cut_in_pct"];
	        this.at_or_above_rated_pct = source["at_or_above_rated_pct"];
	        this.above_cut_out_pct = source["above_cut_out_pct"];
	        this.cut_in_ms = source["cut_in_ms"];
	        this.rated_ms = source["rated_ms"];
	        this.cut_out_ms = source["cut_out_ms"];
	    }
	}
	export class WindExtrapolation {
	    hub_height_m: number;
	    interpolation_ceiling_m: number;
	    height_ratio: number;
	    is_extrapolation: boolean;
	    statement: string;
	
	    static createFrom(source: any = {}) {
	        return new WindExtrapolation(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hub_height_m = source["hub_height_m"];
	        this.interpolation_ceiling_m = source["interpolation_ceiling_m"];
	        this.height_ratio = source["height_ratio"];
	        this.is_extrapolation = source["is_extrapolation"];
	        this.statement = source["statement"];
	    }
	}
	export class WindHub {
	    qualifier: string;
	    extrapolation: WindExtrapolation;
	    mean_speed_ms: number;
	    weibull_k: number;
	    weibull_c_ms: number;
	    wind_power_density_w_m2: number;
	    gross_capacity_factor_pct: number;
	    gross_capacity_factor_no_density_correction_pct: number;
	    gross_annual_energy_mwh_per_turbine: number;
	    operating_regime: WindOperatingRegime;
	    hours_per_year: number;
	    excluded_losses: string[];
	
	    static createFrom(source: any = {}) {
	        return new WindHub(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.qualifier = source["qualifier"];
	        this.extrapolation = this.convertValues(source["extrapolation"], WindExtrapolation);
	        this.mean_speed_ms = source["mean_speed_ms"];
	        this.weibull_k = source["weibull_k"];
	        this.weibull_c_ms = source["weibull_c_ms"];
	        this.wind_power_density_w_m2 = source["wind_power_density_w_m2"];
	        this.gross_capacity_factor_pct = source["gross_capacity_factor_pct"];
	        this.gross_capacity_factor_no_density_correction_pct = source["gross_capacity_factor_no_density_correction_pct"];
	        this.gross_annual_energy_mwh_per_turbine = source["gross_annual_energy_mwh_per_turbine"];
	        this.operating_regime = this.convertValues(source["operating_regime"], WindOperatingRegime);
	        this.hours_per_year = source["hours_per_year"];
	        this.excluded_losses = source["excluded_losses"];
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
	export class WindRoseSector {
	    sector: number;
	    centre_deg: number;
	    energy_pct: number;
	    hours_pct: number;
	
	    static createFrom(source: any = {}) {
	        return new WindRoseSector(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sector = source["sector"];
	        this.centre_deg = source["centre_deg"];
	        this.energy_pct = source["energy_pct"];
	        this.hours_pct = source["hours_pct"];
	    }
	}
	export class WindDirection {
	    convention_note: string;
	    circular_mean_deg_10m: number;
	    circular_mean_deg_50m: number;
	    median_turning_deg: number;
	
	    static createFrom(source: any = {}) {
	        return new WindDirection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.convention_note = source["convention_note"];
	        this.circular_mean_deg_10m = source["circular_mean_deg_10m"];
	        this.circular_mean_deg_50m = source["circular_mean_deg_50m"];
	        this.median_turning_deg = source["median_turning_deg"];
	    }
	}
	export class WindMonthlySpeed {
	    month: number;
	    mean_speed_ms: number;
	
	    static createFrom(source: any = {}) {
	        return new WindMonthlySpeed(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.month = source["month"];
	        this.mean_speed_ms = source["mean_speed_ms"];
	    }
	}
	export class WindWeibullFitCheck {
	    empirical_mean_ms: number;
	    weibull_mean_ms: number;
	    mean_error_pct: number;
	    empirical_mean_cube_m3s3: number;
	    weibull_mean_cube_m3s3: number;
	    mean_cube_error_pct: number;
	    estimator: string;
	
	    static createFrom(source: any = {}) {
	        return new WindWeibullFitCheck(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.empirical_mean_ms = source["empirical_mean_ms"];
	        this.weibull_mean_ms = source["weibull_mean_ms"];
	        this.mean_error_pct = source["mean_error_pct"];
	        this.empirical_mean_cube_m3s3 = source["empirical_mean_cube_m3s3"];
	        this.weibull_mean_cube_m3s3 = source["weibull_mean_cube_m3s3"];
	        this.mean_cube_error_pct = source["mean_cube_error_pct"];
	        this.estimator = source["estimator"];
	    }
	}
	export class WindMeasured {
	    qualifier: string;
	    mean_speed_10m_ms: number;
	    mean_speed_50m_ms: number;
	    shear_exponent: number;
	    weibull_k_50m: number;
	    weibull_c_50m_ms: number;
	    weibull_fit_check_50m: WindWeibullFitCheck;
	    energy_pattern_factor_50m: number;
	    wind_power_density_50m_w_m2: number;
	    air_density_mean_kg_m3: number;
	    air_density_min_kg_m3: number;
	    air_density_max_kg_m3: number;
	    monthly_mean_speed_50m: WindMonthlySpeed[];
	    direction: WindDirection;
	    direction_energy_rose_50m: WindRoseSector[];
	
	    static createFrom(source: any = {}) {
	        return new WindMeasured(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.qualifier = source["qualifier"];
	        this.mean_speed_10m_ms = source["mean_speed_10m_ms"];
	        this.mean_speed_50m_ms = source["mean_speed_50m_ms"];
	        this.shear_exponent = source["shear_exponent"];
	        this.weibull_k_50m = source["weibull_k_50m"];
	        this.weibull_c_50m_ms = source["weibull_c_50m_ms"];
	        this.weibull_fit_check_50m = this.convertValues(source["weibull_fit_check_50m"], WindWeibullFitCheck);
	        this.energy_pattern_factor_50m = source["energy_pattern_factor_50m"];
	        this.wind_power_density_50m_w_m2 = source["wind_power_density_50m_w_m2"];
	        this.air_density_mean_kg_m3 = source["air_density_mean_kg_m3"];
	        this.air_density_min_kg_m3 = source["air_density_min_kg_m3"];
	        this.air_density_max_kg_m3 = source["air_density_max_kg_m3"];
	        this.monthly_mean_speed_50m = this.convertValues(source["monthly_mean_speed_50m"], WindMonthlySpeed);
	        this.direction = this.convertValues(source["direction"], WindDirection);
	        this.direction_energy_rose_50m = this.convertValues(source["direction_energy_rose_50m"], WindRoseSector);
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
	export class WindAnalysis {
	    lon: number;
	    lat: number;
	    grid_cell_centre: number[];
	    grid_note: string;
	    record_years: number;
	    record_window: string;
	    hub_height_m: number;
	    qualifier: string;
	    measured: WindMeasured;
	    hub: WindHub;
	    shear_sensitivity: WindShearRow[];
	    data_quality: WindDataQuality;
	    turbine: WindTurbine;
	    assumptions: WindAssumptions;
	    power_provenance?: PowerProvenance;
	
	    static createFrom(source: any = {}) {
	        return new WindAnalysis(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.lon = source["lon"];
	        this.lat = source["lat"];
	        this.grid_cell_centre = source["grid_cell_centre"];
	        this.grid_note = source["grid_note"];
	        this.record_years = source["record_years"];
	        this.record_window = source["record_window"];
	        this.hub_height_m = source["hub_height_m"];
	        this.qualifier = source["qualifier"];
	        this.measured = this.convertValues(source["measured"], WindMeasured);
	        this.hub = this.convertValues(source["hub"], WindHub);
	        this.shear_sensitivity = this.convertValues(source["shear_sensitivity"], WindShearRow);
	        this.data_quality = this.convertValues(source["data_quality"], WindDataQuality);
	        this.turbine = this.convertValues(source["turbine"], WindTurbine);
	        this.assumptions = this.convertValues(source["assumptions"], WindAssumptions);
	        this.power_provenance = this.convertValues(source["power_provenance"], PowerProvenance);
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
	export class SolarSkyView {
	    applied: boolean;
	    mean_horizon_deg: number;
	    max_horizon_deg: number;
	    threshold_deg: number;
	    diffuse_loss_mean_pct?: number;
	    diffuse_loss_max_pct?: number;
	
	    static createFrom(source: any = {}) {
	        return new SolarSkyView(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.applied = source["applied"];
	        this.mean_horizon_deg = source["mean_horizon_deg"];
	        this.max_horizon_deg = source["max_horizon_deg"];
	        this.threshold_deg = source["threshold_deg"];
	        this.diffuse_loss_mean_pct = source["diffuse_loss_mean_pct"];
	        this.diffuse_loss_max_pct = source["diffuse_loss_max_pct"];
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
	    sky_view?: SolarSkyView;
	    overlay_uri: string;
	    raster_tif: string;
	    extent: Bounds;
	    power_provenance?: PowerProvenance;
	
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
	        this.sky_view = this.convertValues(source["sky_view"], SolarSkyView);
	        this.overlay_uri = source["overlay_uri"];
	        this.raster_tif = source["raster_tif"];
	        this.extent = this.convertValues(source["extent"], Bounds);
	        this.power_provenance = this.convertValues(source["power_provenance"], PowerProvenance);
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
	    power_provenance?: PowerProvenance;
	
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
	        this.power_provenance = this.convertValues(source["power_provenance"], PowerProvenance);
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
	    run_id?: string;
	    mean_confidence: number;
	    confidence_floor?: number;
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
	    energy_model?: EnergyModelAnalysis;
	    wind?: WindAnalysis;
	    domain_fingerprint?: DomainFingerprint;
	
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
	        this.run_id = source["run_id"];
	        this.mean_confidence = source["mean_confidence"];
	        this.confidence_floor = source["confidence_floor"];
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
	        this.energy_model = this.convertValues(source["energy_model"], EnergyModelAnalysis);
	        this.wind = this.convertValues(source["wind"], WindAnalysis);
	        this.domain_fingerprint = this.convertValues(source["domain_fingerprint"], DomainFingerprint);
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
	export class PythonCandidate {
	    path: string;
	    origin: string;
	
	    static createFrom(source: any = {}) {
	        return new PythonCandidate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.origin = source["origin"];
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
	    label?: string;
	    run_label?: string;
	    project_id?: string;
	
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
	
	
	
	export class SolarTerrainRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    hourly_years?: number;
	    season?: string;
	    label?: string;
	    run_label?: string;
	    project_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new SolarTerrainRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.hourly_years = source["hourly_years"];
	        this.season = source["season"];
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
	
	
	
	
	
	
	
	
	
	export class WindRequest {
	    area_id: string;
	    polygon_geojson?: GeoJSONGeometry;
	    record_years?: number;
	    hub_height_m?: number;
	    calm_threshold_ms?: number;
	    record_max_floor_ms?: number;
	    roughness_band_m?: number[];
	    label?: string;
	    run_label?: string;
	    project_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new WindRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.area_id = source["area_id"];
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.record_years = source["record_years"];
	        this.hub_height_m = source["hub_height_m"];
	        this.calm_threshold_ms = source["calm_threshold_ms"];
	        this.record_max_floor_ms = source["record_max_floor_ms"];
	        this.roughness_band_m = source["roughness_band_m"];
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
	
	export class ResolvedPath {
	    label: string;
	    path: string;
	    source?: string;
	    exists: boolean;
	    blocks?: string;
	
	    static createFrom(source: any = {}) {
	        return new ResolvedPath(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.path = source["path"];
	        this.source = source["source"];
	        this.exists = source["exists"];
	        this.blocks = source["blocks"];
	    }
	}
	export class EnvironmentState {
	    active?: backend.EnvReport;
	    candidates: backend.PythonCandidate[];
	    managed_dir: string;
	    managed_active: boolean;
	    env_override: string;
	    building: boolean;
	    paths: ResolvedPath[];
	    retired_vars: string[];
	    config_path: string;
	
	    static createFrom(source: any = {}) {
	        return new EnvironmentState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.active = this.convertValues(source["active"], backend.EnvReport);
	        this.candidates = this.convertValues(source["candidates"], backend.PythonCandidate);
	        this.managed_dir = source["managed_dir"];
	        this.managed_active = source["managed_active"];
	        this.env_override = source["env_override"];
	        this.building = source["building"];
	        this.paths = this.convertValues(source["paths"], ResolvedPath);
	        this.retired_vars = source["retired_vars"];
	        this.config_path = source["config_path"];
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
	
	export class SaveProjectOverlayRequest {
	    project_id: string;
	    run_id: string;
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
	        this.run_id = source["run_id"];
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.meta_json = source["meta_json"];
	        this.overlay_uri = source["overlay_uri"];
	        this.raster_tif = source["raster_tif"];
	    }
	}

}

export namespace store {
	
	export class ActivityDay {
	    day: string;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new ActivityDay(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.day = source["day"];
	        this.count = source["count"];
	    }
	}
	export class BackupCounts {
	    users: number;
	    runs: number;
	    projects: number;
	    overlays: number;
	    assets: number;
	
	    static createFrom(source: any = {}) {
	        return new BackupCounts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.users = source["users"];
	        this.runs = source["runs"];
	        this.projects = source["projects"];
	        this.overlays = source["overlays"];
	        this.assets = source["assets"];
	    }
	}
	export class BackupManifest {
	    format_version: number;
	    created_at: string;
	    app_version: string;
	    excluded: string[];
	    counts: BackupCounts;
	    asset_bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new BackupManifest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.format_version = source["format_version"];
	        this.created_at = source["created_at"];
	        this.app_version = source["app_version"];
	        this.excluded = source["excluded"];
	        this.counts = this.convertValues(source["counts"], BackupCounts);
	        this.asset_bytes = source["asset_bytes"];
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
	    run_id?: string;
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
	        this.run_id = source["run_id"];
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
	export class PurgeResult {
	    removed: number;
	    freed_bytes: number;
	
	    static createFrom(source: any = {}) {
	        return new PurgeResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.removed = source["removed"];
	        this.freed_bytes = source["freed_bytes"];
	    }
	}
	export class RestoreCurrent {
	    runs: number;
	    projects: number;
	
	    static createFrom(source: any = {}) {
	        return new RestoreCurrent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.runs = source["runs"];
	        this.projects = source["projects"];
	    }
	}
	export class RestorePreview {
	    archive_path: string;
	    manifest: BackupManifest;
	    current: RestoreCurrent;
	    problem?: string;
	
	    static createFrom(source: any = {}) {
	        return new RestorePreview(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.archive_path = source["archive_path"];
	        this.manifest = this.convertValues(source["manifest"], BackupManifest);
	        this.current = this.convertValues(source["current"], RestoreCurrent);
	        this.problem = source["problem"];
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
	export class RestoreResult {
	    previous_data_path: string;
	    runs_restored: number;
	    projects_restored: number;
	    assets_restored: number;
	    password_reset_required: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RestoreResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.previous_data_path = source["previous_data_path"];
	        this.runs_restored = source["runs_restored"];
	        this.projects_restored = source["projects_restored"];
	        this.assets_restored = source["assets_restored"];
	        this.password_reset_required = source["password_reset_required"];
	    }
	}
	export class StorageBucket {
	    label: string;
	    bytes: number;
	    files: number;
	    consequence: string;
	
	    static createFrom(source: any = {}) {
	        return new StorageBucket(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.bytes = source["bytes"];
	        this.files = source["files"];
	        this.consequence = source["consequence"];
	    }
	}
	export class StorageGroup {
	    key: string;
	    label: string;
	    bytes: number;
	    count: number;
	
	    static createFrom(source: any = {}) {
	        return new StorageGroup(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.label = source["label"];
	        this.bytes = source["bytes"];
	        this.count = source["count"];
	    }
	}
	export class StorageProjectItem {
	    project_id: string;
	    name: string;
	    bytes: number;
	    overlays: number;
	
	    static createFrom(source: any = {}) {
	        return new StorageProjectItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.project_id = source["project_id"];
	        this.name = source["name"];
	        this.bytes = source["bytes"];
	        this.overlays = source["overlays"];
	    }
	}
	export class StorageRunItem {
	    run_id: string;
	    label: string;
	    kind: string;
	    created_at: string;
	    bytes: number;
	    empty: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StorageRunItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.run_id = source["run_id"];
	        this.label = source["label"];
	        this.kind = source["kind"];
	        this.created_at = source["created_at"];
	        this.bytes = source["bytes"];
	        this.empty = source["empty"];
	    }
	}
	export class StorageReport {
	    data_dir: string;
	    total_bytes: number;
	    buckets: StorageBucket[];
	    runs: StorageRunItem[];
	    by_kind: StorageGroup[];
	    by_file_type: StorageGroup[];
	    by_project: StorageProjectItem[];
	    empty_runs: number;
	    orphan_bytes: number;
	    orphan_count: number;
	
	    static createFrom(source: any = {}) {
	        return new StorageReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.data_dir = source["data_dir"];
	        this.total_bytes = source["total_bytes"];
	        this.buckets = this.convertValues(source["buckets"], StorageBucket);
	        this.runs = this.convertValues(source["runs"], StorageRunItem);
	        this.by_kind = this.convertValues(source["by_kind"], StorageGroup);
	        this.by_file_type = this.convertValues(source["by_file_type"], StorageGroup);
	        this.by_project = this.convertValues(source["by_project"], StorageProjectItem);
	        this.empty_runs = source["empty_runs"];
	        this.orphan_bytes = source["orphan_bytes"];
	        this.orphan_count = source["orphan_count"];
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
	export class WhiteboardMember {
	    id: string;
	    whiteboard_id: string;
	    run_id: string;
	    position: number;
	    name?: string;
	    state_json?: string;
	    missing?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new WhiteboardMember(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.whiteboard_id = source["whiteboard_id"];
	        this.run_id = source["run_id"];
	        this.position = source["position"];
	        this.name = source["name"];
	        this.state_json = source["state_json"];
	        this.missing = source["missing"];
	    }
	}
	export class Whiteboard {
	    id: string;
	    user_id: string;
	    name: string;
	    created_at: string;
	    updated_at: string;
	    view_json?: string;
	    members?: WhiteboardMember[];
	    member_count: number;
	
	    static createFrom(source: any = {}) {
	        return new Whiteboard(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.user_id = source["user_id"];
	        this.name = source["name"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.view_json = source["view_json"];
	        this.members = this.convertValues(source["members"], WhiteboardMember);
	        this.member_count = source["member_count"];
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

