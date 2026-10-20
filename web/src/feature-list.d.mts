import type { FeatureSummary } from './state';

export interface FeatureView { mode: 'status' | 'time'; time: 'created_at' | 'updated_at' }
export interface FeatureGroup { key: string; items: FeatureSummary[] }
export function parseFeatureView(raw: string | null): FeatureView;
export function featureTime(feature: FeatureSummary, field: FeatureView['time']): number | null;
export function groupFeatures(features: FeatureSummary[], options: FeatureView & { query?: string; status?: string; now?: Date }): FeatureGroup[];
