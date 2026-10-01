from vivepdf.ops._document import open_document, unwrap_document
from vivepdf.ops._layers import LayerRow, layer_rows
from vivepdf.rpc.progress import Progress
from vivepdf.rpc.protocol import RpcModel
from vivepdf.rpc.registry import op


class LayersListParams(RpcModel):
    path: str
    password: str | None = None


class LayersListResult(RpcModel):
    layers: list[LayerRow]


@op("layers.list", LayersListParams)
def list_layers(params: LayersListParams, _progress: Progress) -> LayersListResult:
    with open_document(params.path, params.password, mutable=False) as cached:
        return LayersListResult(layers=layer_rows(unwrap_document(cached)))
