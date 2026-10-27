/** Model picker shapes, shared by the host's model state and the pane's picker. */

export interface ModelListItem {
    valueId: string;
    name: string;
}

export interface ModelProviderGroup {
    slug: string;
    name: string;
    isPrimary?: boolean;
    models: ModelListItem[];
}
