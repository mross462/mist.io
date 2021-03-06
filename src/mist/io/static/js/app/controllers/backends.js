define('app/controllers/backends', ['app/models/backend', 'app/models/rule', 'ember'],
    /**
     *  Backends Controller
     *
     *  @returns Class
     */
    function(Backend, Rule) {
        return Ember.ArrayController.extend(Ember.Evented, {

            /**
             *  Properties
             */

            content: [],
            imageCount: 0,
            machineCount: 0,
            selectedMachines: [],
            machineRequest: false,

            addingBackend: false,
            deletingBackend: false,
            togglingBackend: false,
            checkedMonitoring: false,
            checkingMonitoring: false,

            loading: false,
            loadingImages: false,
            loadingMachines: false,

            /**
             *
             *  Initialization
             *
             */

            load: function() {
                var that = this;
                this.set('loading', true);
                Mist.ajax.GET('/backends', {
                }).success(function(backends) {
                    that._setContent(backends);
                }).error(function() {
                    that._reload();
                }).complete(function() {
                    that.set('loading', false);
                    that.trigger('onLoad');
                });
            }.on('init'),


            /**
             *
             *  Methods
             *
             */

            addBackend: function(title, provider, apiKey, apiSecret, apiUrl,
                                 region, tenant, compute_endpoint, port, key,
                                 callback) {
                var that = this;
                this.set('addingBackend', true);
                Mist.ajax.POST('/backends', {
                    'title'       : title,
                    'provider'    : provider,
                    'apikey'      : apiKey,
                    'apisecret'   : apiSecret,
                    'apiurl'      : apiUrl,
                    'tenant_name' : tenant,
                    'region'      : region,
                    'machine_key' : key,
                    'compute_endpoint' : compute_endpoint,
                    'machine_port': port,      // For bare-metal
                    'machine_ip'  : apiKey,    // For bare-metal
                    'machine_user': apiSecret  // For bare-metal
                }).success(function(backend) {
                    that._addBackend(backend, key);
                }).error(function(message) {
                    Mist.notificationController.notify('Failed to add backend: ' + message);
                }).complete(function(success, backend) {
                    that.set('addingBackend', false);
                    if (callback) callback(success, backend);
                });
            },


            renameBackend: function(backendId, newTitle, callback) {
                var that = this;
                this.set('renamingBackend', true);
                Mist.ajax.PUT('/backends/' + backendId, {
                    'new_name': newTitle
                }).success(function() {
                    that._renameBackend(backendId, newTitle);
                }).error(function() {
                    Mist.notificationController.notify('Failed to rename backend');
                }).complete(function(success) {
                    that.set('renamingBackend', false);
                    if (callback) callback(success);
                });
            },


            deleteBackend: function(backendId, callback) {
                var that = this;
                this.set('deletingBackend', true);
                Mist.ajax.DELETE('/backends/' + backendId, {
                }).success(function() {
                    that._deleteBackend(backendId);
                }).error(function() {
                    Mist.notificationController.notify('Failed to delete backend');
                }).complete(function(success) {
                    that.set('deletingBackend', false);
                    if (callback) callback(success);
                });
            },


            toggleBackend: function(backendId, newState, callback) {
                var that = this;
                this.set('togglingBackend', true);
                Mist.ajax.POST('/backends/' + backendId, {
                    'new_state': newState ? '1' : '0'
                }).success(function() {
                    that._toggleBackend(backendId, newState);
                }).error(function() {
                    Mist.notificationController.notify("Failed to change backend's state");
                    that._toggleBackend(backendId, !newState);
                }).complete(function(success) {
                    that.set('togglingBackend', false);
                    if (callback) callback(success);
                });
            },


            probeMachine: function(machine, keyId, callback) {

                // TODO: This should be moved inside machines controller

                function loadToColor(load, cores) {
                    var weightedLoad = load / cores;
                    if (weightedLoad > 1.2) {
                        return 'hot';
                    } else if (weightedLoad > 0.8) {
                        return 'warm';
                    } else if (weightedLoad > 0.4) {
                        return 'eco';
                    } else if (weightedLoad > 0.1) {
                        return 'cool';
                    } else {
                        return 'cold';
                    }
                }

                if (!machine.id || machine.id == -1) return;
                if (!machine.state == 'running') return;

                var host = machine.getHost();
                if (!host) return;

                var key = Mist.keysController.getKey(keyId);
                if (key) {
                    machine.set('probing', keyId);
                    key.set('probing', machine);
                } else {
                    machine.set('probing', true);
                }
                var that = this;
                var uptime = null;
                Mist.ajax.POST('/backends/' + machine.backend.id + '/machines/' + machine.id + '/probe', {
                    'host': host,
                    'key': keyId
                }).success(function(data) {
                    if (!machine.backend || !machine.backend.enabled) return;
                    if (data.uptime) {
                        uptime = parseFloat(data.uptime.split(' ')[0]) * 1000;
                        machine.set('uptimeChecked', Date.now());
                        machine.set('uptimeFromServer', uptime);
                        machine.set('probed', true);
                    } else {
                        machine.set('uptimeChecked', -Date.now());
                    }
                    machine.set('cores', data.cores);
                    machine.set('users', data.users);
                    if (data.loadavg) {
                        machine.set('loadavg1', loadToColor(data.loadavg[0], data.cores));
                        machine.set('loadavg5', loadToColor(data.loadavg[1], data.cores));
                        machine.set('loadavg15', loadToColor(data.loadavg[2], data.cores));
                    }
                    machine.set('loadavg', data.loadavg);
                    machine.set('loss', data.packets_loss);
                    machine.set('latency', Math.floor(data.rtt_avg));

                }).error(function(message) {
                    if (!machine.backend || !machine.backend.enabled) return;
                    if (key) Mist.notificationController.notify(message);
                }).complete(function(success, data) {
                    if (!machine.backend || !machine.backend.enabled) return;
                    if (key) {
                        key.set('probing', false);
                    }
                    machine.set('probing', false);
                    that.trigger('onMachineProbe');
                    if (callback) callback(!!uptime, data);
                });
            },


            updateMachineCount: function() {
                var count = 0;
                var content = this.content;
                var contentLength = this.content.length;
                for (var b = 0; b < contentLength; ++b) {
                    count += content[b].machines.content.length;
                }
                this.set('machineCount', count);
                this.trigger('updateMachines');
            }.observes('content.length'),

            updateImageCount: function() {
                var count = 0;
                this.content.forEach(function(backend) {
                    count += backend.images.content.length;
                });
                this.set('imageCount', count);
            }.observes('content.length'),


            providerList: function() {
                return SUPPORTED_PROVIDERS;
            }.property('providerList'),


            getRequestedMachine: function() {
                if (this.machineRequest) {
                    return this.getMachine(this.machineRequest);
                }
            },


            getBackend: function(backendId) {
                return this.content.findBy('id', backendId);
            },


            getMachine: function(machineId, backendId) {

                if (backendId) {
                    var backend = this.getBackend(backendId);
                    if (backend)
                        return backend.getMachine(machineId);
                    return null;
                }

                var machine = null;
                this.content.some(function(backend) {
                    return machine = backend.getMachine(machineId);
                });
                return machine;
            },


            machineExists: function(machineId, backendId) {
                return !!this.getMachine(machineId, backendId);
            },


            backendExists: function(backendId) {
                return !!this.getBackend(backendId);
            },


            /**
             *
             *  Psudo-Private Methods
             *
             */

            _reload: function() {
                Ember.run.later(this, function() {
                    this.load();
                }, 2000);
            },


            _setContent: function(backends) {
                var that = this;
                Ember.run(function() {
                    that.set('content', []);
                    backends.forEach(function(backend) {
                        if (backend.provider == 'bare_metal')
                            backend.isBareMetal = true;
                        that.content.pushObject(Backend.create(backend));
                    });
                    that.trigger('onBackendListChange');
                });
            },


            _addBackend: function(backend, keyId) {
                Ember.run(this, function() {
                    var backendModel = Backend.create(backend);
                    this.content.pushObject(backendModel);
                    backendModel.one('onMachineListChange', function() {
                        if (backendModel.provider == 'bare_metal') {
                            backendModel.set('isBareMetal', true);
                            Mist.keysController._associateKey(keyId, backendModel.machines.content[0]);
                        }
                    });
                    this.trigger('onBackendListChange');
                    this.trigger('onBackendAdd');
                });
            },


            _deleteBackend: function(id) {
                Ember.run(this, function() {
                    this.content.removeObject(this.getBackend(id));
                    this.trigger('onBackendListChange');
                    this.trigger('onBackendDelete');
                });
            },


            _renameBackend: function(id, newTitle) {
                Ember.run(this, function() {
                    this.getBackend(id).set('title', newTitle);
                    this.trigger('onBackendRename');
                });
            },


            _toggleBackend: function(id, newState) {
                Ember.run(this, function() {
                    this.getBackend(id).set('enabled', newState);
                    this.trigger('onBackendToggle');
                });
            },


            _updateImageCount: function() {
                Ember.run(this, function() {
                    var counter = 0;
                    this.content.forEach(function(backend) {
                        if (backend.enabled) counter += backend.imageCount;
                    });
                    this.set('imageCount', counter);
                    this.trigger('onImageListChange');
                });
            },


            _updateMachineCount: function() {
                Ember.run(this, function() {
                    var counter = 0;
                    this.content.forEach(function(backend) {
                        if (backend.enabled) counter += backend.machineCount;
                    });
                    this.set('machineCount', counter);
                    this.trigger('onMachineListChange');
                });
            },


            _updateLoadingImages: function() {
                Ember.run(this, function() {
                    var loadingImages = false;
                    this.content.some(function(backend) {
                        if (backend.loadingImages) return loadingImages = true;
                    });
                    this.set('loadingImages', loadingImages);
                });
            },


            _updateLoadingMachines: function() {
                Ember.run(this, function() {
                    var loadingMachines = false;
                    this.content.some(function(backend) {
                        if (backend.loadingMachines) return loadingMachines = true;
                    });
                    this.set('loadingMachines', loadingMachines);
                });
            },


            _updateSelectedMachines: function() {
                Ember.run(this, function() {
                    var newSelectedMachines = [];
                    this.content.forEach(function(backend) {
                        newSelectedMachines = newSelectedMachines.concat(backend.selectedMachines);
                    });
                    this.set('selectedMachines', newSelectedMachines);
                    this.trigger('onSelectedMachinesChange');
                });
            },


            /**
             *
             *  Observers
             *
             */

            imageCountObserver: function() {
                Ember.run.once(this, '_updateImageCount');
            }.observes('content.@each.imageCount'),


            mahcineCountObserver: function() {
                Ember.run.once(this, '_updateMachineCount');
            }.observes('content.@each.machineCount'),


            loadingImagesObserver: function() {
                Ember.run.once(this, '_updateLoadingImages');
            }.observes('content.@each.loadingImages'),


            loadingMachinesObserver: function() {
                Ember.run.once(this, '_updateLoadingMachines');
            }.observes('content.@each.loadingMachines'),


            selectedMachinesObserver: function() {
                Ember.run.once(this, '_updateSelectedMachines');
            }.observes('content.@each.selectedMachines')
        });
    }
);
