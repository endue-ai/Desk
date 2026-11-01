# Freezes rows 1-2 and column A of the Budget sheet in budget.xlsx, budget.ods and budget.fods, in the
# form Excel and LibreOffice write when a person freezes panes. LibreOffice drops view settings when
# it converts without a window (--headless), so make.sh writes them here, after the conversion.
import zipfile

ITEM = '<config:config-item config:name="{0}" config:type="{1}">{2}</config:config-item>'
TABLE = "".join(ITEM.format(*item) for item in [
    ("HorizontalSplitMode", "short", 2), ("VerticalSplitMode", "short", 2),
    ("HorizontalSplitPosition", "int", 1), ("VerticalSplitPosition", "int", 2),
    ("ActiveSplitRange", "short", 3), ("PositionLeft", "int", 0), ("PositionRight", "int", 1),
    ("PositionTop", "int", 0), ("PositionBottom", "int", 2)])
VIEWS = ('<config:config-item-map-indexed config:name="Views"><config:config-item-map-entry>'
         + ITEM.format("ViewId", "string", "view1")
         + '<config:config-item-map-named config:name="Tables">'
         + '<config:config-item-map-entry config:name="Budget">' + TABLE
         + "</config:config-item-map-entry></config:config-item-map-named>"
         + ITEM.format("ActiveTable", "string", "Budget")
         + "</config:config-item-map-entry></config:config-item-map-indexed>")
SETTINGS = '<config:config-item-set config:name="ooo:view-settings">'
PANE = ('<pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/>'
        '<selection pane="bottomRight" activeCell="B3" sqref="B3"/>')


def once(text, old, new):
    assert old in text, old
    return text.replace(old, new, 1)


def rezip(path, name, change):
    with zipfile.ZipFile(path) as source:
        entries = [(info, source.read(info)) for info in source.infolist()]
    with zipfile.ZipFile(path, "w") as target:
        for info, data in entries:
            if info.filename == name:
                data = change(data.decode("utf-8")).encode("utf-8")
            target.writestr(info, data, compress_type=info.compress_type)


def pane(text):
    start = text.index("<selection ")
    return text[:start] + PANE + text[text.index("/>", start) + 2:]


rezip("budget.xlsx", "xl/worksheets/sheet1.xml", pane)
rezip("budget.ods", "settings.xml", lambda text: once(text, SETTINGS, SETTINGS + VIEWS))
with open("budget.fods", encoding="utf-8") as file:
    flat = file.read()
with open("budget.fods", "w", encoding="utf-8") as file:
    file.write(once(flat, SETTINGS, SETTINGS + VIEWS))
