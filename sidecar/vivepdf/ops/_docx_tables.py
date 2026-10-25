from docx.shared import Pt
from docx.table import Table, _Cell
from pdf2docx.table.Cell import Cell
from pdf2docx.table.TableBlock import TableBlock


class _MergeAwareCell(_Cell):
    def merge(self, other_cell):
        table = self._parent
        try:
            merged = super().merge(other_cell)
        except BaseException:
            table.cell_cache = None
            raise
        if isinstance(table, _CachedCellsTable):
            table.cover_span(merged._tc)
        return merged


class _CachedCellsTable(Table):
    cell_cache: list | None = None

    @property
    def _cells(self):
        if self.cell_cache is None:
            cells = Table._cells.fget(self)
            for cell in cells:
                cell.__class__ = _MergeAwareCell
            self.cell_cache = cells
        return self.cell_cache

    def cover_span(self, tc) -> None:
        if self.cell_cache is None:
            return
        columns = self._column_count
        cell = _MergeAwareCell(tc, self)
        for row in range(tc.top, tc.bottom):
            for column in range(tc.left, tc.right):
                self.cell_cache[row * columns + column] = cell


_plain_table_make_docx = TableBlock.make_docx


def make_table_with_cached_cells(block: TableBlock, table: Table) -> None:
    table.__class__ = _CachedCellsTable
    try:
        _plain_table_make_docx(block, table)
    finally:
        table.__class__ = Table


_plain_cell_make_docx = Cell.make_docx


def make_cell_sizing_its_column(cell: Cell, table: Table, indexes: tuple[int, int]) -> None:
    _plain_cell_make_docx(cell, table, indexes)
    if cell and cell.merged_cells[1] == 1:
        table.columns[indexes[1]].width = Pt(cell.bbox.width)
