define('app/controllers/keys', [
    'app/models/key',
    'ember',
    'jquery'
    ],
    /**
     * Keys controller
     *
     *
     * @returns Class
     */
    function(Key) {
        return Ember.ArrayController.extend({
            
            keyCount: 0,
            
            init: function() {
                this._super();
                
                var that = this;

                $.getJSON('/keys', function(data) {
                    var content = new Array();
                    data.forEach(function(item){
                        content.push(Key.create(item));
                    });
                    that.set('content', content);
                }).error(function() {
                    Mist.notificationController.notify("Error loading keys");
                });

            },
            
            newKey: function(name, publicKey, privateKey){
                item = {
                    'name':name,
                    'pub': publicKey,
                    'priv': privateKey
                }
                var key = Key.create(item);
                this.addObject(key);
                
                var that = this;

                $.ajax({
                    url: 'keys/' + name,
                    type: 'PUT',
                    contentType: 'application/json',
                    data: JSON.stringify(item),
                    success: function(data) {
                        info('Successfully sent create key ', name);
                    },
                    error: function(jqXHR, textstate, errorThrown) {
                        Mist.notificationController.notify('Error while sending create key'  +
                                name);
                        error(textstate, errorThrown, 'while creating key', name);
                        that.removeObject(key);
                    }
                });
            }
        });
    }
);