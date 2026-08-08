/**
 * features/providers.js — Provider 域前端交互（F9 / WU-05c）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5.3
 *           + § 3.4 API 契约 + § 4.4.6 (IIFE 模式)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-05c
 *
 * 职责（与 spec § 5.3 + plan § 6 WU-05c 对齐）:
 *   - installProvidersView({ container }) → 在指定 DOM 容器内渲染
 *       表格（id / name / baseUrl / defaultModel / enabled / 操作）
 *       + 顶部 toolbar（新建按钮 + 刷新）
 *   - 接入后端 8 条端点:
 *       GET    /api/providers
 *       GET    /api/providers/active
 *       POST   /api/providers
 *       PUT    /api/providers/active
 *       PATCH  /api/providers/active/model
 *       POST   /api/providers/:id/toggle
 *       PUT    /api/providers/:id
 *       DELETE /api/providers/:id
 *   - 创建 / 编辑 Modal（含 Input + Textarea 表单 + 提交 / 取消）
 *   - 删除二次确认 Modal（复用 Modal 组件）
 *   - 「设为 active」「编辑」「启用 / 禁用」「删除」操作按钮
 *   - 接入 providerState store（list + activeId + loading）
 *   - ApiClientError → Toast（error role）
 *   - a11y：<table role="grid"> + <th scope> + 操作按钮 aria-label 含 provider 名
 *   - uninstall() 卸载：清 listener + 摘 DOM + 解订阅
 *
 * 与其他模块的协作:
 *   - 依赖 web/js/shared/api.js 的 apiFetch / ApiClientError
 *   - 依赖 web/js/shared/utils.js 的 el / on / escapeHtml
 *   - 依赖 web/js/state/state.js 的 providerState / getStore
 *   - 依赖 web/js/components/{Button, Input, Textarea, Modal, Toast}.js
 *
 * 不实现:
 *   - sessions / chat / agents / skills / settings（其他 WU）
 *   - compact / clear 等 slash（WU-07a）
 *
 * 加载方式: <script defer> + IIFE,与 spec § 4.4.6 一致。
 * 测试:    test/web/features-providers.test.ts（≥ 14 用例）
 */

(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 模块内常量
  // ------------------------------------------------------------------

  /** Provider 域 8 条端点路径 */
  var ENDPOINTS = {
    list: '/api/providers',
    active: '/api/providers/active',
    create: '/api/providers',
    setActive: '/api/providers/active',
    setActiveModel: '/api/providers/active/model',
    toggle: '/api/providers/:id/toggle',
    update: '/api/providers/:id',
    remove: '/api/providers/:id',
  };

  // ------------------------------------------------------------------
  // 内部工具：依赖拿取（与 components 同模式：不缓存，每次现取）
  // ------------------------------------------------------------------

  function api() {
    return global.MyAgent && global.MyAgent.api;
  }

  function utils() {
    return global.MyAgent && global.MyAgent.utils;
  }

  function i18n() {
    return global.MyAgent && global.MyAgent.i18n;
  }

  function state() {
    return global.MyAgent && global.MyAgent.state;
  }

  function components() {
    return global.MyAgent && global.MyAgent.components;
  }

  // ------------------------------------------------------------------
  // 内部工具：t(key)（缺 i18n 时降级返回 key）
  // ------------------------------------------------------------------

  function t(key, args) {
    var lib = i18n();
    if (lib && typeof lib.t === 'function') {
      try {
        return lib.t.apply(lib, [key].concat(args || []));
      } catch (_e) {
        return key;
      }
    }
    return key;
  }

  // ------------------------------------------------------------------
  // 内部工具：normalizeId
  //   endpoint 含 :id 占位符 → 替换为真实 id（URL 编码）
  // ------------------------------------------------------------------

  function normalizeId(endpoint, id) {
    var encoded = encodeURIComponent(id);
    return endpoint.replace(':id', encoded);
  }

  // ------------------------------------------------------------------
  // 内部工具：errorMessage(err)
  //   把 ApiClientError / Error / string → 人可读字符串
  // ------------------------------------------------------------------

  function errorMessage(err) {
    if (!err) return 'Unknown error';
    if (typeof err === 'string') return err;
    if (err.message) return err.message;
    return String(err);
  }

  // ------------------------------------------------------------------
  // 内部工具：safeDestroy(inst)
  //   安全调用组件 destroy（不存在则忽略）。install/uninstall 时清理用。
  // ------------------------------------------------------------------

  function safeDestroy(inst) {
    if (inst && typeof inst.destroy === 'function') {
      try {
        inst.destroy();
      } catch (_e) {
        /* ignore */
      }
    }
  }

  // ------------------------------------------------------------------
  // 内部：buildFormModal({title, initial, onSubmit, onCancel})
  //   构造创建 / 编辑 Provider 的 Modal。
  //   返回 { open(), close(), destroy(), setError(fieldKey, msg) }
  // ------------------------------------------------------------------

  function buildFormModal(opts) {
    var u = utils();
    var cmps = components();
    if (!u || !cmps) {
      throw new Error('[providers] utils / components 不可用');
    }
    var title = opts && opts.title ? String(opts.title) : 'Provider';
    var initial =
      opts && opts.initial && typeof opts.initial === 'object' ? opts.initial : {};
    var onSubmit = opts && typeof opts.onSubmit === 'function' ? opts.onSubmit : null;
    var onCancel = opts && typeof opts.onCancel === 'function' ? opts.onCancel : null;

    var formValues = {
      id: initial.id || '',
      name: initial.name || '',
      type: initial.type || 'deepseek',
      apiKey: initial.apiKey || '',
      baseUrl: initial.baseUrl || '',
      defaultModel: initial.defaultModel || '',
      enabled: initial.enabled !== undefined ? !!initial.enabled : true,
    };

    var errors = {};

    function makeField(key, label, kind) {
      var isTextarea = kind === 'textarea';
      var Ctor = isTextarea ? cmps.Textarea : cmps.Input;
      var value = formValues[key];
      var errorMsg = errors[key] || '';
      var field = Ctor({
        label: label,
        value: value,
        placeholder: label,
        error: errorMsg,
        rows: isTextarea ? 3 : undefined,
      });
      // 监听 input 同步 formValues
      var inputEl = field.inputEl;
      inputEl.addEventListener('input', function () {
        formValues[key] = inputEl.value;
        // 清错误
        if (errors[key]) {
          delete errors[key];
          // 重建 field（简化做法：直接删掉原 root，构造新的）
          if (field && field.el && field.el.parentNode) {
            field.el.parentNode.removeChild(field.el);
          }
          var nf = makeField(key, label, kind);
          // 替换引用
          field.el = nf.el;
          field.inputEl = nf.inputEl;
        }
      });
      return field;
    }

    // 构造表单字段
    var idField = makeField('id', 'ID', 'text');
    var nameField = makeField('name', '名称', 'text');
    var typeField = makeField('type', '类型', 'text');
    var apiKeyField = makeField('apiKey', 'API Key（空 = 走环境变量）', 'text');
    var baseUrlField = makeField('baseUrl', 'Base URL', 'text');
    var defaultModelField = makeField('defaultModel', '默认模型', 'text');

    var form = u.el('form', { class: 'provider-form' }, [
      idField.el,
      nameField.el,
      typeField.el,
      apiKeyField.el,
      baseUrlField.el,
      defaultModelField.el,
    ]);

    // 取消 / 提交按钮
    var cancelBtn = cmps.Button({
      label: t('common.cancel'),
      variant: 'ghost',
      type: 'button',
      onClick: function () {
        modal.close();
        if (onCancel) {
          try {
            onCancel();
          } catch (_e) {
            /* ignore */
          }
        }
      },
    });

    var submitBtn = cmps.Button({
      label: t('common.save'),
      variant: 'primary',
      type: 'button',
      onClick: function () {
        var payload = {
          id: formValues.id.trim(),
          name: formValues.name.trim(),
          type: formValues.type.trim() || 'deepseek',
          apiKey: formValues.apiKey,
          baseUrl: formValues.baseUrl.trim(),
          defaultModel: formValues.defaultModel.trim(),
          enabled: formValues.enabled,
        };
        var submitErr = null;
        if (!payload.id) submitErr = 'id 必填';
        else if (!payload.name) submitErr = '名称 必填';
        else if (!payload.baseUrl) submitErr = 'baseUrl 必填';
        else if (!payload.defaultModel) submitErr = 'defaultModel 必填';

        if (submitErr) {
          if (onSubmit) {
            onSubmit(
              Object.assign(new Error(submitErr), { validation: true }),
            );
          }
          return;
        }

        if (onSubmit) {
          try {
            var ret = onSubmit(payload);
            if (ret && typeof ret.then === 'function') {
              // Promise：等异步结果
              ret
                .then(function () {
                  modal.close();
                })
                .catch(function (err) {
                  if (onSubmit) {
                    onSubmit(err);
                  }
                });
              return;
            }
          } catch (err) {
            if (onSubmit) onSubmit(err);
            return;
          }
          // 同步成功 → 关闭
          modal.close();
        } else {
          modal.close();
        }
      },
    });

    var modal = cmps.Modal({
      title: title,
      content: form,
      footer: u.el(
        'div',
        { class: 'provider-form-footer' },
        [cancelBtn.el, submitBtn.el],
      ),
      onClose: function () {
        // ESC / overlay 关闭 → 通知取消
        if (onCancel) {
          try {
            onCancel();
          } catch (_e) {
            /* ignore */
          }
        }
      },
    });

    return {
      open: function () {
        modal.open();
      },
      close: function () {
        modal.close();
      },
      destroy: function () {
        safeDestroy(cancelBtn);
        safeDestroy(submitBtn);
        try {
          modal.destroy();
        } catch (_e) {
          /* ignore */
        }
      },
      // 表单实例引用
      fields: {
        id: idField,
        name: nameField,
        type: typeField,
        apiKey: apiKeyField,
        baseUrl: baseUrlField,
        defaultModel: defaultModelField,
      },
    };
  }

  // ------------------------------------------------------------------
  // 内部：buildConfirmModal({title, body, confirmLabel, onConfirm, onCancel})
  //   删除确认 Modal
  // ------------------------------------------------------------------

  function buildConfirmModal(opts) {
    var u = utils();
    var cmps = components();
    if (!u || !cmps) {
      throw new Error('[providers] utils / components 不可用');
    }
    var title = opts && opts.title ? String(opts.title) : '确认';
    var body = opts && opts.body ? String(opts.body) : '';
    var confirmLabel = opts && opts.confirmLabel ? String(opts.confirmLabel) : t('common.confirm');
    var onConfirm = opts && typeof opts.onConfirm === 'function' ? opts.onConfirm : null;
    var onCancel = opts && typeof opts.onCancel === 'function' ? opts.onCancel : null;

    var cancelBtn = cmps.Button({
      label: t('common.cancel'),
      variant: 'ghost',
      type: 'button',
      onClick: function () {
        modal.close();
        if (onCancel) {
          try {
            onCancel();
          } catch (_e) {
            /* ignore */
          }
        }
      },
    });

    var confirmBtn = cmps.Button({
      label: confirmLabel,
      variant: 'danger',
      type: 'button',
      onClick: function () {
        modal.close();
        if (onConfirm) {
          try {
            onConfirm();
          } catch (_e) {
            /* ignore */
          }
        }
      },
    });

    var content = u.el('div', { class: 'provider-confirm-body' }, [body]);

    var modal = cmps.Modal({
      title: title,
      content: content,
      footer: u.el(
        'div',
        { class: 'provider-confirm-footer' },
        [cancelBtn.el, confirmBtn.el],
      ),
      onClose: function () {
        if (onCancel) {
          try {
            onCancel();
          } catch (_e) {
            /* ignore */
          }
        }
      },
    });

    return {
      open: function () {
        modal.open();
      },
      close: function () {
        modal.close();
      },
      destroy: function () {
        safeDestroy(cancelBtn);
        safeDestroy(confirmBtn);
        try {
          modal.destroy();
        } catch (_e) {
          /* ignore */
        }
      },
    };
  }

  // ------------------------------------------------------------------
  // 内部：setLoading(store, loading) — 切 store.loading + 触发 UI 刷新
  // ------------------------------------------------------------------

  function setLoading(store, loading) {
    if (!store) return;
    try {
      store.set(
        Object.assign({}, store.get(), { loading: !!loading }),
      );
    } catch (_e) {
      // 静默
    }
  }

  // ------------------------------------------------------------------
  // 内部：updateProvidersInStore(store, list, activeId)
  //   写入新数据；loading=false
  // ------------------------------------------------------------------

  function updateProvidersInStore(store, list, activeId) {
    if (!store) return;
    var next = {
      providers: Array.isArray(list) ? list : [],
      activeProviderId: activeId || null,
      loading: false,
    };
    try {
      store.set(next);
    } catch (_e) {
      // 静默
    }
  }

  // ------------------------------------------------------------------
  // 内部：setActiveInStore(store, activeId, list)
  //   仅更新 activeProviderId（保留 list）
  // ------------------------------------------------------------------

  function setActiveInStore(store, activeId, list) {
    if (!store) return;
    var current = store.get();
    var next = Object.assign({}, current, {
      activeProviderId: activeId || null,
    });
    if (list) next.providers = list;
    try {
      store.set(next);
    } catch (_e) {
      // 静默
    }
  }

  // ------------------------------------------------------------------
  // 内部：optimisticUpdateEnabled(store, id, enabled)
  //   乐观更新：先改 enabled，再 await 后端
  // ------------------------------------------------------------------

  function optimisticUpdateEnabled(store, id, enabled) {
    if (!store) return;
    var current = store.get();
    var list = current.providers || [];
    var next = list.map(function (p) {
      if (p && p.id === id) return Object.assign({}, p, { enabled: !!enabled });
      return p;
    });
    try {
      store.set(Object.assign({}, current, { providers: next }));
    } catch (_e) {
      // 静默
    }
  }

  // ==================================================================
  // installProvidersView({ container })
  //   渲染 Provider 表格到 container；返回 { refresh, destroy }
  // ==================================================================

  function installProvidersView(opts) {
    opts = opts || {};
    var container = opts.container;
    if (!container || !container.appendChild) {
      throw new Error('[installProvidersView] container 必须是一个 DOM 元素');
    }

    var u = utils();
    var cmps = components();
    var apiLib = api();
    var stateLib = state();
    if (!u || !cmps || !apiLib || !stateLib) {
      throw new Error('[installProvidersView] 依赖不可用（utils/components/api/state）');
    }

    var providerStore =
      stateLib.getStore && stateLib.getStore('providerState')
        ? stateLib.getStore('providerState')
        : null;

    // 当前打开的 Modal 实例（用于 uninstall 时清理）
    var currentFormModal = null;
    var currentConfirmModal = null;
    var currentToast = null;
    var unsubscribers = [];
    var destroyed = false;

    // ------------------------------------------------------------------
    // showError(err) — 显示 error toast
    // ------------------------------------------------------------------

    function showError(err) {
      var message = errorMessage(err);
      // 如果已经存在一个 toast → 复用
      if (!currentToast) {
        currentToast = cmps.Toast({});
      }
      currentToast.show({ message: message, status: 'error' });
    }

    // ------------------------------------------------------------------
    // showInfo(message) — 显示 info toast
    // ------------------------------------------------------------------

    function showInfo(message) {
      if (!currentToast) {
        currentToast = cmps.Toast({});
      }
      currentToast.show({ message: String(message), status: 'info' });
    }

    // ------------------------------------------------------------------
    // fetchList() — 拉列表 + active
    // ------------------------------------------------------------------

    function fetchList() {
      if (!providerStore) {
        return Promise.resolve({ list: [], activeId: null });
      }
      setLoading(providerStore, true);
      return Promise.all([
        apiLib.apiFetch(ENDPOINTS.list).catch(function (err) {
          showError(err);
          return [];
        }),
        apiLib
          .apiFetch(ENDPOINTS.active)
          .then(function (data) {
            return (data && data.id) || null;
          })
          .catch(function (_err) {
            return null;
          }),
      ]).then(function (results) {
        var list = results[0] || [];
        var activeId = results[1] || null;
        updateProvidersInStore(providerStore, list, activeId);
        return { list: list, activeId: activeId };
      });
    }

    // ------------------------------------------------------------------
    // createProvider(payload)
    // ------------------------------------------------------------------

    function createProvider(payload) {
      if (!providerStore) {
        return Promise.reject(new Error('providerState 不可用'));
      }
      setLoading(providerStore, true);
      return apiLib
        .apiFetch(ENDPOINTS.create, { method: 'POST', body: payload })
        .then(function (created) {
          showInfo('已创建: ' + (created && created.name ? created.name : payload.name));
          return fetchList();
        })
        .catch(function (err) {
          showError(err);
          // 重新拉一次确保一致
          return fetchList().then(function () {
            throw err;
          });
        });
    }

    // ------------------------------------------------------------------
    // updateProvider(id, payload)
    // ------------------------------------------------------------------

    function updateProvider(id, payload) {
      if (!providerStore) {
        return Promise.reject(new Error('providerState 不可用'));
      }
      setLoading(providerStore, true);
      var url = normalizeId(ENDPOINTS.update, id);
      return apiLib
        .apiFetch(url, { method: 'PUT', body: payload })
        .then(function (updated) {
          showInfo('已更新: ' + (updated && updated.name ? updated.name : payload.name));
          return fetchList();
        })
        .catch(function (err) {
          showError(err);
          return fetchList().then(function () {
            throw err;
          });
        });
    }

    // ------------------------------------------------------------------
    // deleteProvider(id)
    // ------------------------------------------------------------------

    function deleteProvider(id) {
      if (!providerStore) {
        return Promise.reject(new Error('providerState 不可用'));
      }
      setLoading(providerStore, true);
      var url = normalizeId(ENDPOINTS.remove, id);
      return apiLib
        .apiFetch(url, { method: 'DELETE' })
        .then(function () {
          showInfo('已删除: ' + id);
          return fetchList();
        })
        .catch(function (err) {
          showError(err);
          return fetchList().then(function () {
            throw err;
          });
        });
    }

    // ------------------------------------------------------------------
    // setActive(id)
    // ------------------------------------------------------------------

    function setActive(id) {
      if (!providerStore) {
        return Promise.reject(new Error('providerState 不可用'));
      }
      setLoading(providerStore, true);
      return apiLib
        .apiFetch(ENDPOINTS.setActive, { method: 'PUT', body: { id: id } })
        .then(function (data) {
          var newActiveId = (data && data.id) || id;
          setActiveInStore(providerStore, newActiveId);
          showInfo('已切换到: ' + id);
          return fetchList();
        })
        .catch(function (err) {
          showError(err);
          return fetchList().then(function () {
            throw err;
          });
        });
    }

    // ------------------------------------------------------------------
    // toggleEnabled(id, currentEnabled)
    // ------------------------------------------------------------------

    function toggleEnabled(id, currentEnabled) {
      if (!providerStore) {
        return Promise.reject(new Error('providerState 不可用'));
      }
      var nextEnabled = !currentEnabled;
      // 乐观更新
      optimisticUpdateEnabled(providerStore, id, nextEnabled);
      var url = normalizeId(ENDPOINTS.toggle, id);
      return apiLib
        .apiFetch(url, { method: 'POST' })
        .then(function (updated) {
          var finalEnabled = updated && typeof updated.enabled === 'boolean' ? updated.enabled : nextEnabled;
          // 用服务器返回值修正 store
          optimisticUpdateEnabled(providerStore, id, finalEnabled);
          // 若 active 改变，刷新 activeId
          return fetchList();
        })
        .catch(function (err) {
          showError(err);
          // 回滚乐观更新
          optimisticUpdateEnabled(providerStore, id, currentEnabled);
          return fetchList().then(function () {
            throw err;
          });
        });
    }

    // ------------------------------------------------------------------
    // openCreateModal()
    // ------------------------------------------------------------------

    function openCreateModal() {
      safeDestroy(currentFormModal);
      var modal = buildFormModal({
        title: '新建 Provider',
        initial: { type: 'deepseek', enabled: true },
        onSubmit: function (payload) {
          if (payload && payload.validation) {
            showError(payload.message || '表单校验失败');
            return;
          }
          if (payload instanceof Error || (payload && payload.message && !payload.id)) {
            showError(payload.message || '提交失败');
            return;
          }
          // 异步提交
          return createProvider(payload).catch(function () {
            // 错误已在 createProvider 内显示 toast
          });
        },
      });
      currentFormModal = modal;
      modal.open();
    }

    // ------------------------------------------------------------------
    // openEditModal(provider)
    // ------------------------------------------------------------------

    function openEditModal(provider) {
      if (!provider || !provider.id) return;
      safeDestroy(currentFormModal);
      var modal = buildFormModal({
        title: '编辑 Provider: ' + provider.name,
        initial: {
          id: provider.id || '',
          name: provider.name || '',
          type: provider.type || 'deepseek',
          apiKey: provider.apiKey || '',
          baseUrl: provider.baseUrl || '',
          defaultModel: provider.defaultModel || '',
          enabled: provider.enabled !== undefined ? !!provider.enabled : true,
        },
        onSubmit: function (payload) {
          if (payload && payload.validation) {
            showError(payload.message || '表单校验失败');
            return;
          }
          if (payload instanceof Error || (payload && payload.message && !payload.id)) {
            showError(payload.message || '提交失败');
            return;
          }
          return updateProvider(provider.id, payload).catch(function () {});
        },
      });
      currentFormModal = modal;
      modal.open();
    }

    // ------------------------------------------------------------------
    // openDeleteConfirm(provider)
    // ------------------------------------------------------------------

    function openDeleteConfirm(provider) {
      if (!provider || !provider.id) return;
      safeDestroy(currentConfirmModal);
      var modal = buildConfirmModal({
        title: '删除 Provider',
        body: '确认删除 "' + (provider.name || provider.id) + '"？此操作不可撤销。',
        confirmLabel: t('common.delete'),
        onConfirm: function () {
          deleteProvider(provider.id).catch(function () {});
        },
      });
      currentConfirmModal = modal;
      modal.open();
    }

    // ------------------------------------------------------------------
    // renderToolbar() — 顶部 toolbar
    // ------------------------------------------------------------------

    function renderToolbar() {
      var addBtn = cmps.Button({
        label: '+ 新建 Provider',
        variant: 'primary',
        type: 'button',
        ariaLabel: '新建 Provider',
        onClick: function () {
          openCreateModal();
        },
      });

      var refreshBtn = cmps.Button({
        label: t('common.refresh'),
        variant: 'secondary',
        type: 'button',
        ariaLabel: '刷新列表',
        onClick: function () {
          fetchList().catch(function () {});
        },
      });

      return u.el(
        'div',
        { class: 'provider-toolbar' },
        [addBtn.el, refreshBtn.el],
      );
    }

    // ------------------------------------------------------------------
    // renderTable(list, activeId) — 表格
    // ------------------------------------------------------------------

    function renderTable(list, activeId) {
      var table = u.el(
        'table',
        {
          class: 'provider-table',
          role: 'grid',
          'aria-label': 'Provider 列表',
        },
      );

      var thead = u.el('thead', {}, [
        u.el('tr', {}, [
          u.el('th', { scope: 'col' }, ['ID']),
          u.el('th', { scope: 'col' }, ['名称']),
          u.el('th', { scope: 'col' }, ['Base URL']),
          u.el('th', { scope: 'col' }, ['默认模型']),
          u.el('th', { scope: 'col' }, ['启用']),
          u.el('th', { scope: 'col' }, ['操作']),
        ]),
      ]);
      table.appendChild(thead);

      var tbody = u.el('tbody', {});

      if (!Array.isArray(list) || list.length === 0) {
        var emptyTr = u.el('tr', {}, [
          u.el(
            'td',
            {
              colspan: '6',
              class: 'provider-empty-cell',
            },
            [t('provider.empty') || '尚未配置任何提供商'],
          ),
        ]);
        tbody.appendChild(emptyTr);
      } else {
        list.forEach(function (p) {
          var isActive = activeId && p.id === activeId;
          var rowAttrs = {};
          if (isActive) rowAttrs['data-active'] = 'true';

          // 操作按钮
          var actions = u.el('div', { class: 'provider-actions' }, []);

          // 「设为 active」：仅非 active 行显示
          if (!isActive) {
            actions.appendChild(
              cmps.Button({
                label: t('provider.activate') || '设为当前',
                variant: 'ghost',
                type: 'button',
                ariaLabel: '把 ' + (p.name || p.id) + ' 设为当前 Provider',
                onClick: function () {
                  setActive(p.id).catch(function () {});
                },
              }).el,
            );
          } else {
            actions.appendChild(
              u.el(
                'span',
                { class: 'provider-active-badge', 'aria-label': (p.name || p.id) + ' 是当前 Provider' },
                [t('provider.active') || '当前'],
              ),
            );
          }

          // 编辑
          actions.appendChild(
            cmps.Button({
              label: t('common.edit') || '编辑',
              variant: 'secondary',
              type: 'button',
              ariaLabel: '编辑 ' + (p.name || p.id),
              onClick: function () {
                openEditModal(p);
              },
            }).el,
          );

          // 启用 / 禁用 toggle
          actions.appendChild(
            cmps.Button({
              label: p.enabled ? '禁用' : '启用',
              variant: 'ghost',
              type: 'button',
              ariaLabel:
                (p.enabled ? '禁用 ' : '启用 ') + (p.name || p.id),
              onClick: function () {
                toggleEnabled(p.id, !!p.enabled).catch(function () {});
              },
            }).el,
          );

          // 删除
          actions.appendChild(
            cmps.Button({
              label: t('common.delete') || '删除',
              variant: 'danger',
              type: 'button',
              ariaLabel: '删除 ' + (p.name || p.id),
              onClick: function () {
                openDeleteConfirm(p);
              },
            }).el,
          );

          var row = u.el(
            'tr',
            rowAttrs,
            [
              u.el('td', {}, [p.id || '']),
              u.el('td', {}, [p.name || '']),
              u.el('td', {}, [p.baseUrl || '']),
              u.el('td', {}, [p.defaultModel || '']),
              u.el(
                'td',
                { 'aria-label': p.enabled ? '已启用' : '已禁用' },
                [p.enabled ? '是' : '否'],
              ),
              u.el('td', {}, [actions]),
            ],
          );
          tbody.appendChild(row);
        });
      }

      table.appendChild(tbody);
      return table;
    }

    // ------------------------------------------------------------------
    // renderView() — 整体视图
    // ------------------------------------------------------------------

    function renderView() {
      // 清空 container（用 children.length 而非 firstChild,避免对测试 mock 的 firstChild 缺失敏感）
      while (container.children && container.children.length > 0) {
        container.removeChild(container.children[0]);
      }

      var toolbar = renderToolbar();
      container.appendChild(toolbar);

      var data = providerStore ? providerStore.get() : { providers: [], activeProviderId: null, loading: false };
      var list = data.providers || [];
      var activeId = data.activeProviderId || null;

      var table = renderTable(list, activeId);
      container.appendChild(table);

      if (data.loading) {
        container.appendChild(
          u.el(
            'div',
            { class: 'provider-loading', 'aria-live': 'polite' },
            [t('common.loading') || '加载中…'],
          ),
        );
      }
    }

    // ------------------------------------------------------------------
    // 订阅 store 变化（自动重新渲染）
    // ------------------------------------------------------------------

    if (providerStore && typeof providerStore.subscribe === 'function') {
      var unsub = providerStore.subscribe(function () {
        if (destroyed) return;
        renderView();
      });
      if (typeof unsub === 'function') unsubscribers.push(unsub);
    }

    // ------------------------------------------------------------------
    // 初始渲染
    // ------------------------------------------------------------------

    renderView();

    // 拉一次真实数据（即使 store 已有值）
    fetchList().catch(function () {});

    // ------------------------------------------------------------------
    // 返回 public API
    // ------------------------------------------------------------------

    return {
      /** 主动刷新（GET list + active） */
      refresh: function () {
        return fetchList();
      },
      /** 销毁：清理所有 listener / DOM / Modal / 订阅 */
      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        // 清理 modal
        safeDestroy(currentFormModal);
        safeDestroy(currentConfirmModal);
        // 清理 toast 容器（Toasts 自身有 destroy）
        if (currentToast && typeof currentToast.destroy === 'function') {
          try {
            currentToast.destroy();
          } catch (_e) {
            /* ignore */
          }
        }
        // 解订阅
        for (var i = 0; i < unsubscribers.length; i++) {
          try {
            unsubscribers[i]();
          } catch (_e) {
            /* ignore */
          }
        }
        unsubscribers.length = 0;
        // 清空 container
        try {
          while (container.children && container.children.length > 0) {
            container.removeChild(container.children[0]);
          }
        } catch (_e) {
          /* ignore */
        }
      },
    };
  }

  // ------------------------------------------------------------------
  // 导出（spec § 4.2 全局变量模块通信）
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.providersFeature = {
    installProvidersView: installProvidersView,
    // 内部 helper 暴露，便于测试
    _buildFormModal: buildFormModal,
    _buildConfirmModal: buildConfirmModal,
    _ENDPOINTS: ENDPOINTS,
    _normalizeId: normalizeId,
    _errorMessage: errorMessage,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
