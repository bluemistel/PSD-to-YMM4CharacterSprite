import React, { useState, useEffect, useRef, useCallback } from 'react';
import { readPsd } from 'ag-psd';

const fs = window.require ? window.require('fs-extra') : {};
const path = window.require ? window.require('path') : {};
const { webUtils } = window.require ? window.require('electron') : {};

// Back-to-Front rendering order
const RENDER_ORDER = ['後', '体', '顔色', '口', '目', '眉', '髪', '他'];
const SLOT_COUNT = 3; // For '他' and '後'

const INITIAL_MAPPING_DATA = RENDER_ORDER.reduce((acc, cat) => {
  acc[cat] = {
    mode: cat === '体' ? 'composite' : 'simple',
    items: [],
    composites: cat === '体' ? [{ name: '体1', layers: [] }] : []
  };
  return acc;
}, {});

function App() {
  const [psdData, setPsdData] = useState(null);
  const [psdPath, setPsdPath] = useState('');
  const [treeData, setTreeData] = useState([]);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [viewMode, setViewMode] = useState('mapping'); // 'mapping' or 'preview'

  // Selection State
  const [selectedPaths, setSelectedPaths] = useState(new Set());
  const [lastSelectedPath, setLastSelectedPath] = useState(null);

  // Unified Mapping Data
  const [mappingData, setMappingData] = useState(INITIAL_MAPPING_DATA);

  const [selections, setSelections] = useState({});
  const [disabledSlots, setDisabledSlots] = useState(new Set()); // Hidden slots for '他' and '後'
  const [isProcessing, setIsProcessing] = useState(false);
  const canvasRef = useRef(null);
  const nodeMapRef = useRef(new Map());
  const [outputPath, setOutputPath] = useState('');

  // Export Modal State
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportWidth, setExportWidth] = useState(0);
  const [exportHeight, setExportHeight] = useState(0);
  const [maintainAspect, setMaintainAspect] = useState(true);
  const [exportFolderName, setExportFolderName] = useState('');

  // Resizing state
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [mappingWidth, setMappingWidth] = useState(340);
  const isResizingSidebar = useRef(false);
  const isResizingMapping = useRef(false);

  const sanitizeFilename = (name) => {
    return name.replace(/[\\/:*?"<>|!]/g, '').trim();
  };

  const saveState = useCallback(async (currentPsdPath, currentMappingData, currentSelections, currentDisabledSlots, currentOutputPath, currentFolderName) => {
    if (!currentPsdPath) return;
    try {
      const configPath = `${currentPsdPath}.config.json`;
      const stateToSave = {
        mappingData: currentMappingData,
        selections: currentSelections,
        disabledSlots: Array.from(currentDisabledSlots),
        outputPath: currentOutputPath,
        exportFolderName: currentFolderName,
        version: '10.0' // Phase 10 version
      };
      await fs.writeJson(configPath, stateToSave, { spaces: 2 });
    } catch (err) {
      console.error('Failed to auto-save state:', err);
    }
  }, []);

  useEffect(() => {
    if (psdPath && !isProcessing) {
      const timer = setTimeout(() => {
        saveState(psdPath, mappingData, selections, disabledSlots, outputPath, exportFolderName);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [mappingData, selections, disabledSlots, outputPath, exportFolderName, psdPath, saveState, isProcessing]);

  // Resizing handlers
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingSidebar.current) {
        setSidebarWidth(Math.max(150, Math.min(600, e.clientX)));
      }
      if (isResizingMapping.current) {
        const width = window.innerWidth - e.clientX;
        setMappingWidth(Math.max(250, Math.min(800, width)));
      }
    };
    const handleMouseUp = () => {
      isResizingSidebar.current = false;
      isResizingMapping.current = false;
      document.body.style.cursor = 'default';
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleDrop = async (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      let filePath = file.path;
      if (!filePath && webUtils && webUtils.getPathForFile) {
        try { filePath = webUtils.getPathForFile(file); } catch (err) { }
      }
      if (filePath && filePath.toLowerCase().endsWith('.psd')) {
        loadPsd(filePath);
      }
    }
  };

  const loadPsd = async (filePath) => {
    setIsProcessing(true);
    try {
      const buffer = await fs.readFile(filePath);
      const psd = readPsd(buffer, { skipLayerImageData: false, skipThumbnail: true });
      setPsdData(psd);
      setPsdPath(filePath);

      const psdDir = path.dirname(filePath);
      const psdName = path.basename(filePath, path.extname(filePath));
      setOutputPath(psdDir);
      setExportFolderName(`${psdName}_Export`);
      setExportWidth(psd.width);
      setExportHeight(psd.height);

      const buildTree = (children, parentPath = '') => {
        return children.map(child => {
          const currentPath = parentPath ? `${parentPath}/${child.name}` : child.name;
          return {
            id: currentPath,
            name: child.name,
            fullPath: currentPath,
            isFolder: !!child.children,
            node: child,
            children: child.children ? buildTree(child.children, currentPath) : null
          };
        });
      };

      const tree = psd.children ? buildTree(psd.children) : [];
      const flatMap = new Map();
      const flatList = [];
      const traverse = (nodes) => {
        nodes.forEach(n => {
          flatMap.set(n.fullPath, n.node);
          flatList.push(n.fullPath);
          if (n.children) traverse(n.children);
        });
      };
      traverse(tree);
      nodeMapRef.current = flatMap;
      nodeMapRef.current.pathList = flatList;

      setTreeData(tree);
      setExpandedNodes(new Set());
      setMappingData(INITIAL_MAPPING_DATA);
      setSelections({});
      setDisabledSlots(new Set());
      setSelectedPaths(new Set());

      const configPath = `${filePath}.config.json`;
      if (await fs.pathExists(configPath)) {
        const savedState = await fs.readJson(configPath);
        if (savedState) {
          if (savedState.mappingData) {
            setMappingData(savedState.mappingData);
          } else {
            // Backward compatibility
            const migrated = { ...INITIAL_MAPPING_DATA };
            if (savedState.mappings) {
              Object.entries(savedState.mappings).forEach(([cat, list]) => {
                migrated[cat].items = list;
              });
            }
            if (savedState.bodyVariants) {
              migrated['体'].composites = savedState.bodyVariants;
            }
            setMappingData(migrated);
          }
          if (savedState.selections) setSelections(savedState.selections);
          if (savedState.disabledSlots) setDisabledSlots(new Set(savedState.disabledSlots));
          if (savedState.outputPath) setOutputPath(savedState.outputPath);
          if (savedState.exportFolderName) setExportFolderName(savedState.exportFolderName);
        }
      }
    } catch (err) {
      console.error("Failed to load PSD:", err);
      alert("Failed to load PSD file.");
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleExpand = (nodeId) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) newExpanded.delete(nodeId);
    else newExpanded.add(nodeId);
    setExpandedNodes(newExpanded);
  };

  const handleNodeClick = (e, node) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;

    if (isShift && lastSelectedPath && nodeMapRef.current.pathList) {
      const list = nodeMapRef.current.pathList;
      const startIdx = list.indexOf(lastSelectedPath);
      const endIdx = list.indexOf(node.fullPath);
      const [low, high] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      const range = list.slice(low, high + 1);
      setSelectedPaths(new Set([...selectedPaths, ...range]));
    } else if (isCtrl) {
      const newSelected = new Set(selectedPaths);
      if (newSelected.has(node.fullPath)) newSelected.delete(node.fullPath);
      else newSelected.add(node.fullPath);
      setSelectedPaths(newSelected);
    } else {
      setSelectedPaths(new Set([node.fullPath]));
    }
    setLastSelectedPath(node.fullPath);
  };

  const handleCategoryDrop = (e, category, compositeIdx = null) => {
    e.preventDefault();
    const dragType = e.dataTransfer.getData('dragType');
    const newData = { ...mappingData };
    const catConfig = newData[category];

    if (dragType === 'internal-reorder') {
      const sourceIdx = parseInt(e.dataTransfer.getData('sourceIdx'));
      const sourceCompIdx = parseInt(e.dataTransfer.getData('sourceCompIdx'));
      const sourceCat = e.dataTransfer.getData('sourceCat');

      if (sourceCat === category && sourceCompIdx === compositeIdx) {
        const layers = [...catConfig.composites[compositeIdx].layers];
        const [moved] = layers.splice(sourceIdx, 1);
        layers.push(moved); // Simple push to end if dropped on the zone broadly
        catConfig.composites[compositeIdx].layers = layers;
        setMappingData(newData);
      }
      return;
    }

    const nodeDataStr = e.dataTransfer.getData('nodes');
    if (!nodeDataStr) return;
    const dropNodes = JSON.parse(nodeDataStr);

    const processNodeRecursive = (node, result) => {
      const liveNode = nodeMapRef.current.get(node.fullPath);
      if (!node.isFolder) {
        result.push(node);
      } else {
        if (liveNode && liveNode.children) {
          const hasSub = liveNode.children.some(c => c.children && c.children.length > 0);
          if (hasSub) {
            alert(`フォルダ ${node.name} は多階層のため展開できません`);
          } else {
            liveNode.children.forEach(child => {
              const childPath = `${node.fullPath}/${child.name}`;
              result.push({
                id: childPath,
                name: `${node.name}_${child.name}`,
                fullPath: childPath,
                isFolder: false
              });
            });
          }
        }
      }
    };

    const dropProcessor = (targetList) => {
      const existingPaths = new Set(targetList.map(item => item.fullPath));
      const processed = [];
      dropNodes.forEach(n => processNodeRecursive(n, processed));
      processed.forEach(n => {
        if (!existingPaths.has(n.fullPath)) {
          targetList.push(n);
        }
      });
    };

    if (catConfig.mode === 'composite' && compositeIdx !== null) {
      dropProcessor(catConfig.composites[compositeIdx].layers);
    } else {
      dropProcessor(catConfig.items);
      if (!selections[category]) setSelections(prev => ({ ...prev, [category]: 0 }));
    }

    setMappingData(newData);
  };

  const handleInternalReorder = (e, category, compositeIdx, targetIdx) => {
    e.preventDefault();
    e.stopPropagation();
    const dragType = e.dataTransfer.getData('dragType');
    if (dragType !== 'internal-reorder') return;

    const sourceIdx = parseInt(e.dataTransfer.getData('sourceIdx'));
    const sourceCompIdx = parseInt(e.dataTransfer.getData('sourceCompIdx'));
    const sourceCat = e.dataTransfer.getData('sourceCat');

    if (sourceCat === category && sourceCompIdx === compositeIdx && sourceIdx !== targetIdx) {
      const newData = { ...mappingData };
      const layers = [...newData[category].composites[compositeIdx].layers];
      const [moved] = layers.splice(sourceIdx, 1);
      layers.splice(targetIdx, 0, moved);
      newData[category].composites[compositeIdx].layers = layers;
      setMappingData(newData);
    }
  };

  const removeFromCategory = (category, fullPath, compositeIdx = null) => {
    const newData = { ...mappingData };
    const catConfig = newData[category];
    if (catConfig.mode === 'composite' && compositeIdx !== null) {
      catConfig.composites[compositeIdx].layers = catConfig.composites[compositeIdx].layers.filter(l => l.fullPath !== fullPath);
    } else {
      catConfig.items = catConfig.items.filter(n => n.fullPath !== fullPath);
    }
    setMappingData(newData);
  };

  const clearCategory = (category) => {
    const newData = { ...mappingData };
    const catConfig = newData[category];
    if (catConfig.mode === 'composite') {
      catConfig.composites = [{ name: `${category}1`, layers: [] }];
    } else {
      catConfig.items = [];
    }
    setMappingData(newData);
    setSelections(prev => ({ ...prev, [category]: 0 }));
    if (category === '他' || category === '後') {
      const newSelections = { ...selections };
      for (let i = 1; i <= SLOT_COUNT; i++) newSelections[`${category}${i}`] = 0;
      setSelections(newSelections);
    }
  };

  const toggleCategoryMode = (category) => {
    const newData = { ...mappingData };
    const catConfig = newData[category];
    catConfig.mode = catConfig.mode === 'simple' ? 'composite' : 'simple';
    if (catConfig.mode === 'composite' && catConfig.composites.length === 0) {
      catConfig.composites = [{ name: `${category}1`, layers: [] }];
    }
    setMappingData(newData);
  };

  const incrementName = (name) => {
    const match = name.match(/(\d+)$/);
    if (match) {
      const num = parseInt(match[1]);
      return name.replace(/\d+$/, num + 1);
    }
    return name + " 2";
  };

  const addCompositeVariant = (category) => {
    const newData = { ...mappingData };
    const catConfig = newData[category];
    const lastName = catConfig.composites.length > 0 ? catConfig.composites[catConfig.composites.length - 1].name : `${category}0`;
    catConfig.composites.push({
      name: incrementName(lastName),
      layers: []
    });
    setMappingData(newData);
  };

  const duplicateCompositeVariant = (category, idx) => {
    const newData = { ...mappingData };
    const catConfig = newData[category];
    const source = catConfig.composites[idx];
    catConfig.composites.splice(idx + 1, 0, {
      name: incrementName(source.name),
      layers: [...source.layers]
    });
    setMappingData(newData);
  };

  const removeCompositeVariant = (category, idx) => {
    const newData = { ...mappingData };
    const catConfig = newData[category];
    if (catConfig.composites.length <= 1) return;
    catConfig.composites.splice(idx, 1);
    setMappingData(newData);
  };

  const toggleSlotVisibility = (slotKey) => {
    const newDisabled = new Set(disabledSlots);
    if (newDisabled.has(slotKey)) newDisabled.delete(slotKey);
    else newDisabled.add(slotKey);
    setDisabledSlots(newDisabled);
  };

  const isValidCanvas = (canvas) => {
    return canvas && (canvas instanceof HTMLCanvasElement || canvas instanceof ImageBitmap);
  };

  const drawNodeRecursively = (targetNode, context, scale = 1) => {
    if (!targetNode) return;
    if (isValidCanvas(targetNode.canvas)) {
      context.drawImage(targetNode.canvas, targetNode.left * scale, targetNode.top * scale, targetNode.canvas.width * scale, targetNode.canvas.height * scale);
    } else if (targetNode.children) {
      targetNode.children.forEach(child => drawNodeRecursively(child, context, scale));
    }
  };

  const renderPreview = () => {
    if (!psdData || !canvasRef.current || !nodeMapRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    canvas.width = psdData.width;
    canvas.height = psdData.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (viewMode === 'mapping') {
      if (selectedPaths.size > 0) {
        selectedPaths.forEach(p => {
          const liveNode = nodeMapRef.current.get(p);
          drawNodeRecursively(liveNode, ctx);
        });
      }
    } else {
      const mappedPaths = new Set();
      Object.values(mappingData).forEach(cat => {
        cat.items.forEach(i => mappedPaths.add(i.fullPath));
        cat.composites.forEach(c => c.layers.forEach(l => mappedPaths.add(l.fullPath)));
      });

      const drawBaseLayers = (children, currentPath = '') => {
        children.forEach(child => {
          const path = currentPath ? `${currentPath}/${child.name}` : child.name;
          if (!mappedPaths.has(path)) {
            if (!child.children) {
              if (isValidCanvas(child.canvas)) ctx.drawImage(child.canvas, child.left, child.top);
            } else {
              drawBaseLayers(child.children, path);
            }
          }
        });
      };

      drawBaseLayers(psdData.children);

      RENDER_ORDER.forEach(category => {
        const catConfig = mappingData[category];
        if (catConfig.mode === 'composite') {
          const variantIdx = selections[category] || 0;
          const variant = catConfig.composites[variantIdx];
          if (variant) {
            variant.layers.forEach(l => {
              const liveNode = nodeMapRef.current.get(l.fullPath);
              drawNodeRecursively(liveNode, ctx);
            });
          }
        } else if (category === '他' || category === '後') {
          for (let i = 1; i <= SLOT_COUNT; i++) {
            const slotKey = `${category}${i}`;
            if (disabledSlots.has(slotKey)) continue;
            const idx = selections[slotKey] || 0;
            const item = catConfig.items[idx];
            if (item) {
              const liveNode = nodeMapRef.current.get(item.fullPath);
              drawNodeRecursively(liveNode, ctx);
            }
          }
        } else {
          const items = catConfig.items;
          const selectedIdx = selections[category] || 0;
          const item = items[selectedIdx];
          if (item) {
            const liveNode = nodeMapRef.current.get(item.fullPath);
            drawNodeRecursively(liveNode, ctx);
          }
        }
      });
    }
  };

  useEffect(() => {
    renderPreview();
  }, [psdData, selections, mappingData, disabledSlots, viewMode, selectedPaths]);

  const handleWidthChange = (val) => {
    const w = parseInt(val) || 0;
    setExportWidth(w);
    if (maintainAspect && psdData) {
      setExportHeight(Math.round(w / (psdData.width / psdData.height)));
    }
  };

  const handleHeightChange = (val) => {
    const h = parseInt(val) || 0;
    setExportHeight(h);
    if (maintainAspect && psdData) {
      setExportWidth(Math.round(h * (psdData.width / psdData.height)));
    }
  };

  const handleExport = async () => {
    if (!psdData || !outputPath || !exportFolderName) {
      alert("Invalid export settings.");
      return;
    }
    setIsProcessing(true);
    setShowExportModal(false);

    try {
      const scale = exportWidth / psdData.width;
      const finalOutputPath = path.join(outputPath, exportFolderName);
      await fs.ensureDir(finalOutputPath);

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = exportWidth;
      exportCanvas.height = exportHeight;
      const exCtx = exportCanvas.getContext('2d');

      const saveImage = async (drawFn, dir, fileName) => {
        await fs.ensureDir(dir);
        exCtx.clearRect(0, 0, exportCanvas.width, exportCanvas.height);
        drawFn(exCtx);
        const buffer = await canvasToBuffer(exportCanvas);
        const sanitizedName = sanitizeFilename(fileName);
        await fs.writeFile(path.join(dir, `${sanitizedName}.png`), buffer);
      };

      for (const category of RENDER_ORDER) {
        const catConfig = mappingData[category];
        const categoryDir = path.join(finalOutputPath, category);

        if (catConfig.mode === 'composite') {
          for (const variant of catConfig.composites) {
            if (variant.layers.length === 0) continue;
            await saveImage((ctx) => {
              variant.layers.forEach(l => {
                const liveNode = nodeMapRef.current.get(l.fullPath);
                drawNodeRecursively(liveNode, ctx, scale);
              });
            }, categoryDir, variant.name);
          }
        } else {
          for (const item of catConfig.items) {
            await saveImage((ctx) => {
              const liveNode = nodeMapRef.current.get(item.fullPath);
              drawNodeRecursively(liveNode, ctx, scale);
            }, categoryDir, item.name);
          }
        }
      }
      alert("Export completed successfully!");
    } catch (err) {
      console.error(err);
      alert("Export failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const canvasToBuffer = (canvas) => {
    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(Buffer.from(reader.result));
        reader.readAsArrayBuffer(blob);
      }, 'image/png');
    });
  };

  const renderTreeNode = (node, depth = 0) => {
    const isExpanded = expandedNodes.has(node.id);
    const isSelected = selectedPaths.has(node.fullPath);

    const isNodeMapped = (p) => {
      return Object.values(mappingData).some(cat => {
        const inSimple = cat.items.some(i => i.fullPath === p);
        const inComp = cat.composites.some(v => v.layers.some(l => l.fullPath === p));
        return inSimple || inComp;
      });
    };

    if (viewMode === 'preview' && isNodeMapped(node.fullPath)) return null;

    return (
      <div key={node.id} className="tree-node-container" style={{ marginLeft: `${depth * 12}px` }}>
        <div
          className={`node-item ${node.isFolder ? 'folder' : 'layer'} ${isSelected ? 'selected' : ''}`}
          draggable
          onDragStart={(e) => {
            const nodesToDrag = [];
            if (selectedPaths.has(node.fullPath)) {
              selectedPaths.forEach(p => {
                const n = nodeMapRef.current.get(p);
                if (n) nodesToDrag.push({ id: p, name: n.name, fullPath: p, isFolder: !!n.children });
              });
            } else {
              nodesToDrag.push({ id: node.id, name: node.name, fullPath: node.fullPath, isFolder: node.isFolder });
            }
            e.dataTransfer.setData('nodes', JSON.stringify(nodesToDrag));
            e.dataTransfer.setData('dragType', 'external-layer');
          }}
          onClick={(e) => handleNodeClick(e, node)}
        >
          {node.isFolder && (
            <span className="expand-icon" onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}>
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
          <span className="icon">{node.isFolder ? '📁' : '🖼️'}</span>
          <span className="name">{node.name}</span>
        </div>
        {node.isFolder && isExpanded && node.children && (
          <div className="tree-children">
            {node.children.map(child => renderTreeNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app-container main-layout">
      <header className="header glass">
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <h1>PSD to YMM4</h1>
          {psdData && (
            <div className="mode-switcher glass">
              <button className={viewMode === 'mapping' ? 'active' : ''} onClick={() => setViewMode('mapping')}>Mapping</button>
              <button className={viewMode === 'preview' ? 'active' : ''} onClick={() => setViewMode('preview')}>Preview</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="btn-primary" onClick={() => setShowExportModal(true)} disabled={!psdData || isProcessing}>
            {isProcessing ? 'Exporting...' : 'Export to YMM4'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="tree-sidebar glass" style={{ width: `${sidebarWidth}px`, flex: 'none' }}>
          <div className="sidebar-header">
            <h3>Layers</h3>
            {!psdData && <span style={{ fontSize: '0.8rem', opacity: 0.5 }}>No file loaded</span>}
          </div>
          <div className="scroll-area">
            {treeData.map(node => renderTreeNode(node))}
          </div>
        </aside>

        <div className="resizer-h" onMouseDown={() => {
          isResizingSidebar.current = true;
          document.body.style.cursor = 'col-resize';
        }} />

        <main className="preview-center" style={{ flex: 1 }}>
          <div className="canvas-wrapper glass" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
            {!psdData ? <div className="drop-zone"><p>Drag & Drop PSD here</p></div> : <canvas ref={canvasRef} />}
            {viewMode === 'mapping' && selectedPaths.size > 0 && <div className="selection-label">Viewing: {selectedPaths.size} items</div>}
          </div>
          {viewMode === 'preview' && (
            <div className="viewer-controls glass">
              <h4>Live Preview Controls</h4>
              <div className="category-sliders">
                {RENDER_ORDER.slice().reverse().map(category => {
                  const catConfig = mappingData[category];
                  if (catConfig.mode === 'composite') {
                    const items = catConfig.composites;
                    return items.length > 0 && (
                      <div key={`slider-${category}`} className="mini-slider composite">
                        <div className="label">
                          <span>{category} (Composite)</span>
                          <span className="val">{items[selections[category] || 0]?.name}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={items.length - 1}
                          value={selections[category] || 0}
                          onChange={(e) => setSelections({ ...selections, [category]: parseInt(e.target.value) })}
                        />
                      </div>
                    );
                  } else if (category === '他' || category === '後') {
                    return [1, 2, 3].map(i => {
                      const slotKey = `${category}${i}`;
                      const items = catConfig.items;
                      const isHidden = disabledSlots.has(slotKey);
                      return items.length > 0 && (
                        <div key={`slider-${slotKey}`} className={`mini-slider slot ${isHidden ? 'hidden' : ''}`}>
                          <div className="label">
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <button
                                className={`visibility-toggle ${isHidden ? 'off' : 'on'}`}
                                onClick={() => toggleSlotVisibility(slotKey)}
                                title={isHidden ? 'Show Slot' : 'Hide Slot'}
                              >
                                {isHidden ? '👁️‍🗨️' : '👁️'}
                              </button>
                              <span className="slot-badge">{slotKey}</span>
                            </div>
                            <span className="val">{items[selections[slotKey] || 0]?.name}</span>
                          </div>
                          <input
                            type="range"
                            min="0"
                            max={items.length - 1}
                            value={selections[slotKey] || 0}
                            disabled={isHidden}
                            onChange={(e) => setSelections({ ...selections, [slotKey]: parseInt(e.target.value) })}
                          />
                        </div>
                      );
                    });
                  }
                  const items = catConfig.items;
                  return items.length > 0 && (
                    <div key={`slider-${category}`} className="mini-slider">
                      <div className="label">
                        <span>{category}</span>
                        <span className="val">{items[selections[category] || 0]?.name}</span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max={items.length - 1}
                        value={selections[category] || 0}
                        onChange={(e) => setSelections({ ...selections, [category]: parseInt(e.target.value) })}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>

        <div className="resizer-h" onMouseDown={() => {
          isResizingMapping.current = true;
          document.body.style.cursor = 'col-resize';
        }} />

        <div className="mapping-grid glass" style={{ width: `${mappingWidth}px`, flex: 'none' }}>
          <div className="mapping-header">
            <h3>Category Mapping</h3>
          </div>
          <div className="grid">
            {RENDER_ORDER.slice().reverse().map(category => {
              const catConfig = mappingData[category];
              return (
                <div key={`zone-${category}`} className={`category-zone glass ${catConfig.mode} ${viewMode === 'preview' ? 'dimmed' : ''}`}>
                  <div className="zone-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <h4 title="ドラッグ&ドロップの後に名前をクリックして選択">{category}</h4>
                      <div
                        className="mode-toggle"
                        onClick={() => toggleCategoryMode(category)}
                        title="結合グループを作成します。グループ内は1枚に結合された見た目になります"
                      >
                        <div className={`track ${catConfig.mode}`}>
                          <div className="thumb" />
                        </div>
                        <span className="label">Composite</span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <button className="btn-clear" onClick={() => clearCategory(category)}>Clear All</button>
                      {catConfig.mode === 'composite' && (
                        <button className="btn-icon add" onClick={() => addCompositeVariant(category)} title="Add Variant">+</button>
                      )}
                    </div>
                  </div>

                  {catConfig.mode === 'composite' && (
                    <p className="order-hint">左側が奥、右側が手前に描画されます</p>
                  )}

                  {catConfig.mode === 'composite' ? (
                    <div className="composites-list">
                      {catConfig.composites.map((variant, cIdx) => (
                        <div
                          key={`comp-${category}-${cIdx}-${variant.name}`} className="composite-item"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleCategoryDrop(e, category, cIdx)}
                        >
                          <div className="item-header">
                            <input
                              type="text" value={variant.name}
                              onChange={(e) => {
                                const newData = { ...mappingData };
                                newData[category].composites[cIdx].name = e.target.value;
                                setMappingData(newData);
                              }}
                            />
                            <div className="actions">
                              <button className="btn-icon" onClick={() => duplicateCompositeVariant(category, cIdx)} title="Duplicate">📑</button>
                              <button className="btn-icon delete" onClick={() => removeCompositeVariant(category, cIdx)}>×</button>
                            </div>
                          </div>
                          <div className="assigned-nodes">
                            {variant.layers.map((l, lIdx) => (
                              <div
                                key={`layer-${category}-${cIdx}-${lIdx}-${l.fullPath}`}
                                className="assigned-node mini draggable"
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  e.dataTransfer.setData('sourceIdx', lIdx);
                                  e.dataTransfer.setData('sourceCompIdx', cIdx);
                                  e.dataTransfer.setData('sourceCat', category);
                                  e.dataTransfer.setData('dragType', 'internal-reorder');
                                }}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => handleInternalReorder(e, category, cIdx, lIdx)}
                              >
                                <span>{l.name}</span>
                                <button onClick={() => removeFromCategory(category, l.fullPath, cIdx)}>×</button>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      className="assigned-nodes list-mode"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleCategoryDrop(e, category)}
                    >
                      {catConfig.items.map((n, nIdx) => (
                        <div key={`item-${category}-${nIdx}-${n.fullPath}`} className="assigned-node mini">
                          <span title={n.name}>{n.name}</span>
                          <button onClick={() => removeFromCategory(category, n.fullPath)}>×</button>
                        </div>
                      ))}
                      {catConfig.items.length === 0 && <span className="placeholder">Drop layers here</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showExportModal && (
        <div className="modal-overlay">
          <div className="modal-content glass">
            <h2>Export Settings</h2>
            <div className="form-group">
              <label>Output Directory:</label>
              <input type="text" value={outputPath} onChange={(e) => setOutputPath(e.target.value)} placeholder="Path" className="glass" />
            </div>
            <div className="form-group">
              <label>Folder Name:</label>
              <input type="text" value={exportFolderName} onChange={(e) => setExportFolderName(e.target.value)} className="glass" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Width:</label>
                <input type="number" value={exportWidth} onChange={(e) => handleWidthChange(e.target.value)} className="glass" />
              </div>
              <div className="form-group">
                <label>Height:</label>
                <input type="number" value={exportHeight} onChange={(e) => handleHeightChange(e.target.value)} className="glass" />
              </div>
            </div>
            <div className="form-group checkbox">
              <label>
                <input type="checkbox" checked={maintainAspect} onChange={(e) => setMaintainAspect(e.target.checked)} />
                Maintain Aspect Ratio
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowExportModal(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleExport}>Export</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
