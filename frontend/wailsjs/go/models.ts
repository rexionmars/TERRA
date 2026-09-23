export namespace analysis {
	
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
	export class ClassSpectrumPoint {
	    class_id: number;
	    name: string;
	    color: string;
	    band: string;
	    wavelength_nm: number;
	    n_pixels: number;
	    mean: number;
	    sd: number;
	    p05: number;
	    p95: number;
	
	    static createFrom(source: any = {}) {
	        return new ClassSpectrumPoint(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.class_id = source["class_id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.band = source["band"];
	        this.wavelength_nm = source["wavelength_nm"];
	        this.n_pixels = source["n_pixels"];
	        this.mean = source["mean"];
	        this.sd = source["sd"];
	        this.p05 = source["p05"];
	        this.p95 = source["p95"];
	    }
	}
	export class ClassSpectra {
	    scene_date: string;
	    scene_id?: string;
	    n_scenes: number;
	    convention: string;
	    bands: string[];
	    points: ClassSpectrumPoint[];
	
	    static createFrom(source: any = {}) {
	        return new ClassSpectra(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scene_date = source["scene_date"];
	        this.scene_id = source["scene_id"];
	        this.n_scenes = source["n_scenes"];
	        this.convention = source["convention"];
	        this.bands = source["bands"];
	        this.points = this.convertValues(source["points"], ClassSpectrumPoint);
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
	export class CompositeRequest {
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
	    polygon_geojson?: GeoJSONGeometry;
	    mapbiomas_path?: string;
	
	    static createFrom(source: any = {}) {
	        return new LULCRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
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
	export class LibraryBand {
	    band: string;
	    wavelength_nm: number;
	    reflectance: number;
	
	    static createFrom(source: any = {}) {
	        return new LibraryBand(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.band = source["band"];
	        this.wavelength_nm = source["wavelength_nm"];
	        this.reflectance = source["reflectance"];
	    }
	}
	export class LibraryClassBand {
	    band: string;
	    wavelength_nm: number;
	    canopy: number;
	    leaf: number;
	    ratio?: number;
	    unit_canopy?: number;
	    unit_leaf?: number;
	
	    static createFrom(source: any = {}) {
	        return new LibraryClassBand(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.band = source["band"];
	        this.wavelength_nm = source["wavelength_nm"];
	        this.canopy = source["canopy"];
	        this.leaf = source["leaf"];
	        this.ratio = source["ratio"];
	        this.unit_canopy = source["unit_canopy"];
	        this.unit_leaf = source["unit_leaf"];
	    }
	}
	export class LibraryClass {
	    class_id: number;
	    name: string;
	    color: string;
	    angle_rad: number;
	    bands: LibraryClassBand[];
	
	    static createFrom(source: any = {}) {
	        return new LibraryClass(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.class_id = source["class_id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.angle_rad = source["angle_rad"];
	        this.bands = this.convertValues(source["bands"], LibraryClassBand);
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
	
	export class LibraryReference {
	    material: string;
	    source: string;
	    package_id: string;
	    n_spectra: number;
	    level: string;
	    note: string;
	    bands: LibraryBand[];
	
	    static createFrom(source: any = {}) {
	        return new LibraryReference(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.material = source["material"];
	        this.source = source["source"];
	        this.package_id = source["package_id"];
	        this.n_spectra = source["n_spectra"];
	        this.level = source["level"];
	        this.note = source["note"];
	        this.bands = this.convertValues(source["bands"], LibraryBand);
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
	export class LibraryLimit {
	    reference: LibraryReference;
	    scene_date: string;
	    classes: LibraryClass[];
	
	    static createFrom(source: any = {}) {
	        return new LibraryLimit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.reference = this.convertValues(source["reference"], LibraryReference);
	        this.scene_date = source["scene_date"];
	        this.classes = this.convertValues(source["classes"], LibraryClass);
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
	    area_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new PredictRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
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
	        this.area_id = source["area_id"];
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
	    run_id?: string;
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
	        this.run_id = source["run_id"];
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
	    pixel_size_m?: number;
	    class_stats: ClassStat[];
	    class_spectra?: ClassSpectra;
	    library_limit?: LibraryLimit;
	    temporal: TemporalPoint[];
	    vi_series: VISeriesPoint[];
	    vi_series_crop?: VISeriesPoint[];
	    crop_pixel_pct?: number;
	    phenology: PhenologyMetrics;
	    phenology_states: PhenologyStatePoint[];
	    lulc?: LULCAnalysis;
	    water?: WaterAnalysis;
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
	        this.pixel_size_m = source["pixel_size_m"];
	        this.class_stats = this.convertValues(source["class_stats"], ClassStat);
	        this.class_spectra = this.convertValues(source["class_spectra"], ClassSpectra);
	        this.library_limit = this.convertValues(source["library_limit"], LibraryLimit);
	        this.temporal = this.convertValues(source["temporal"], TemporalPoint);
	        this.vi_series = this.convertValues(source["vi_series"], VISeriesPoint);
	        this.vi_series_crop = this.convertValues(source["vi_series_crop"], VISeriesPoint);
	        this.crop_pixel_pct = source["crop_pixel_pct"];
	        this.phenology = this.convertValues(source["phenology"], PhenologyMetrics);
	        this.phenology_states = this.convertValues(source["phenology_states"], PhenologyStatePoint);
	        this.lulc = this.convertValues(source["lulc"], LULCAnalysis);
	        this.water = this.convertValues(source["water"], WaterAnalysis);
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
	export class ResearchExportMeta {
	    model_kind: string;
	    aoi_label: string;
	    polygon_geojson: string;
	
	    static createFrom(source: any = {}) {
	        return new ResearchExportMeta(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.model_kind = source["model_kind"];
	        this.aoi_label = source["aoi_label"];
	        this.polygon_geojson = source["polygon_geojson"];
	    }
	}
	
	
	
	
	export class WaterRequest {
	    polygon_geojson?: GeoJSONGeometry;
	    start: string;
	    end: string;
	    max_cloud: number;
	    monthly_best: boolean;
	    index?: string;
	    label?: string;
	    run_label?: string;
	    project_id?: string;
	    area_id?: string;
	
	    static createFrom(source: any = {}) {
	        return new WaterRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.polygon_geojson = this.convertValues(source["polygon_geojson"], GeoJSONGeometry);
	        this.start = source["start"];
	        this.end = source["end"];
	        this.max_cloud = source["max_cloud"];
	        this.monthly_best = source["monthly_best"];
	        this.index = source["index"];
	        this.label = source["label"];
	        this.run_label = source["run_label"];
	        this.project_id = source["project_id"];
	        this.area_id = source["area_id"];
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

export namespace geocode {
	
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
	    active?: pyenv.EnvReport;
	    candidates: pyenv.PythonCandidate[];
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
	        this.active = this.convertValues(source["active"], pyenv.EnvReport);
	        this.candidates = this.convertValues(source["candidates"], pyenv.PythonCandidate);
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
	    area_id: string;
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
	        this.area_id = source["area_id"];
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.meta_json = source["meta_json"];
	        this.overlay_uri = source["overlay_uri"];
	        this.raster_tif = source["raster_tif"];
	    }
	}

}

export namespace pyenv {
	
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
	export class OptionalPackage {
	    spec: string;
	    name: string;
	    enables: string;
	    size: string;
	
	    static createFrom(source: any = {}) {
	        return new OptionalPackage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.spec = source["spec"];
	        this.name = source["name"];
	        this.enables = source["enables"];
	        this.size = source["size"];
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
	export class Area {
	    id: string;
	    project_id: string;
	    user_id: string;
	    name: string;
	    polygon_geojson: string;
	    notes: string;
	    created_at: string;
	    updated_at: string;
	    run_count: number;
	
	    static createFrom(source: any = {}) {
	        return new Area(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project_id = source["project_id"];
	        this.user_id = source["user_id"];
	        this.name = source["name"];
	        this.polygon_geojson = source["polygon_geojson"];
	        this.notes = source["notes"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.run_count = source["run_count"];
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
	    area_id?: string;
	
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
	        this.area_id = source["area_id"];
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
	    last_area_id?: string;
	    area_count?: number;
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
	        this.last_area_id = source["last_area_id"];
	        this.area_count = source["area_count"];
	        this.run_count = source["run_count"];
	        this.overlay_count = source["overlay_count"];
	    }
	}
	export class ProjectOverlay {
	    id: string;
	    project_id: string;
	    run_id?: string;
	    area_id?: string;
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
	        this.area_id = source["area_id"];
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
	
	export class StudioMember {
	    id: string;
	    studio_id: string;
	    run_id: string;
	    position: number;
	    missing?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new StudioMember(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.studio_id = source["studio_id"];
	        this.run_id = source["run_id"];
	        this.position = source["position"];
	        this.missing = source["missing"];
	    }
	}
	export class Studio {
	    id: string;
	    user_id: string;
	    project_id?: string;
	    name: string;
	    created_at: string;
	    updated_at: string;
	    view_json?: string;
	    members?: StudioMember[];
	    member_count: number;
	
	    static createFrom(source: any = {}) {
	        return new Studio(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.user_id = source["user_id"];
	        this.project_id = source["project_id"];
	        this.name = source["name"];
	        this.created_at = source["created_at"];
	        this.updated_at = source["updated_at"];
	        this.view_json = source["view_json"];
	        this.members = this.convertValues(source["members"], StudioMember);
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

