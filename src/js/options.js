( function ( w, d ) {

'use strict';

w.chrome = ( ( typeof browser != 'undefined' ) && browser.runtime ) ? browser : chrome;


var DEBUG = false,
    USER_AGENT = w.navigator.userAgent.toLowerCase(),
    IS_EDGE = ( 0 <= USER_AGENT.indexOf( 'edge' ) ),
    IS_FIREFOX = ( 0 <= USER_AGENT.indexOf( 'firefox' ) ),
    //IS_VIVALDI = ( 0 <= USER_AGENT.indexOf( 'vivaldi' ) ), // TODO: userAgentに'vivaldi'の文字が含まれなくなっている
    
    value_updated = false,
    background_window = chrome.extension.getBackgroundPage();

if ( ! background_window ) {
    background_window = {
        log_debug : function () {
            if ( ! DEBUG ) {
                return;
            }
            console.log.apply( console, arguments );
        },
        log_error : function () {
            console.error.apply( console, arguments );
        },
    };
}

background_window.log_debug( '***** options ******' );


var test_event_type = 'unknown';

function request_reload_tabs( forced = false ) {
    if ( DEBUG ) {
        chrome.runtime.sendMessage( {
            type : `TEST-${d.visibilityState}-*** ${test_event_type} ***`,
        }, function ( response ) {
            background_window.log_debug( response, '< RELOAD_TABS event done >' );
        } );
    }
    
    background_window.log_debug( '< unloaded > value_updated:', value_updated );
    
    if ( ( ! forced ) && ( ! value_updated ) ) {
        return;
    }
    
    value_updated = false;
    
    if ( typeof background_window.reload_tabs == 'function' ) {
        // Manifest V2だとpopup(options_ui)→backgroundのsendMessage()がうまく動作しない
        // →backgroundpage下の関数を直接呼び出す
        background_window.reload_tabs();
        // オプションを変更した場合にタブをリロード
        // ※TODO: 一度でも変更すると、値が同じであってもリロードされる
        
        background_window.log_debug( '< reload_tabs() done >' );
    }
    else {
        // Manifest V3(Service Worker)だとbackgroundのwindowにはアクセスできない
        // →代わりにsendMessage()使用
        chrome.runtime.sendMessage( {
            type : 'RELOAD_TABS',
        }, function ( response ) {
            background_window.log_debug( response, '< RELOAD_TABS event done >' );
        } );
    }
}


// TODO: Vivaldi(少なくとも2.5.1525.48以降)ではoptions_ui(popup)を閉じてもunloadイベントは発生せず、次にpopupを開いたときに発生してしまう
// → 暫定的に blur イベントで対処
// TODO: Manifest V3のChromeだとunloadやunloadイベント内のsendMessage()ではService Workerにメッセージが届かない模様
// → visibilitychangeイベントで代替
$( w ).on( 'unload blur visibilitychange', function ( event ) {
    if ( ( event.type == 'visibilitychange' ) && ( d.visibilityState != 'hidden' ) ) {
        return;
    }
    test_event_type = event.type;
    request_reload_tabs();
} );


var get_active_tab_info = function() {
        return new Promise( ( resolve, reject ) => {
            chrome.tabs.query( { active : true, currentWindow : true }, tabs => {
                if ( ( ! tabs ) || ( ! tabs[ 0 ] ) ) {
                    reject();
                    return;
                }
                
                var tab_id = tabs[0].id,
                    resolve_tab_info = ( tab_info ) => {
                        if ( ! tab_info ) {
                            reject();
                            return;
                        }
                        if ( ! tab_info.url ) {
                            reject();
                            return;
                        }
                        tab_info.tab = tabs[ 0 ];
                        resolve( tab_info );
                    };
                
                if ( background_window.CONTENT_TAB_INFOS ) {
                    resolve_tab_info( background_window.CONTENT_TAB_INFOS[tab_id] );
                }
                else {
                    chrome.runtime.sendMessage( {
                        type : 'GET_TAB_INFO',
                        tab_id : tab_id,
                    }, function ( response ) {
                        resolve_tab_info( response.tab_info );
                    } );
                }
            } );
        } );
    };

$( async function () {
    var RADIO_KV_LIST = [
            { key : 'IMAGE_DOWNLOAD_LINK', val : true }
        ,   { key : 'VIDEO_DOWNLOAD_LINK', val : true }
        ,   { key : 'OPEN_MEDIA_LINK_BY_DEFAULT', val : false }
        ,   { key : 'ENABLE_ZIPREQUEST', val : true }
        ,   { key : 'ENABLE_FILTER', val : true }
        ,   { key : 'ENABLE_VIDEO_DOWNLOAD', val : true }
        ,   { key : 'ENABLED_ON_TWEETDECK', val : true }
        ,   { key : 'TAB_SORTING', val : true }
        ,   { key : 'AUTO_CONTINUE', val : true }
        ],
        
        INT_KV_LIST = [
            { key : 'DOWNLOAD_SIZE_LIMIT_MB', val : 500, min : 100, max : 10000 }
        ],
        
        STR_KV_LIST = [
        ],
        
        OPTION_KEY_LIST = ( function () {
                var option_keys = [];
                
                RADIO_KV_LIST.forEach( function( radio_kv ) {
                    option_keys.push( radio_kv.key );
                } );
                
                INT_KV_LIST.forEach( function( int_kv ) {
                    option_keys.push( int_kv.key );
                } );
                
                STR_KV_LIST.forEach( function( str_kv ) {
                    option_keys.push( str_kv.key );
                } );
                
                option_keys.push( 'OPERATION' );
                
                return option_keys;
            } )();
    
    var $bulk_download_button = $('input[name="BULK_DOWNLOAD"]'),
        $bulk_download_likes_button = $('input[name="BULK_DOWNLOAD_LIKES"]'),
        bulk_download_is_ready = false,
        bulk_download_likes_is_ready = false;
    
    $bulk_download_button.hide();
    $bulk_download_likes_button.hide();
    
    var active_tab_info = await get_active_tab_info().catch( error => ({}) );
    
    if ( active_tab_info.url ) {
        var pathname = new URL( active_tab_info.url ).pathname,
            pagename = ( pathname.match(/^\/([^/]+)/) || {} )[1];
        
        switch ( pagename ) {
            case 'home' :
            case 'explore' :
            case 'messages' :
            case 'settings' : {
                break;
            }
            case 'i' : {
                if ( /^\/i\/bookmarks(?=\/|$)/.test(pathname) ) {
                    bulk_download_is_ready = true;
                }
                break;
            }
            case 'search' :
            case 'hashtag' :
            case 'notifications' : {
                bulk_download_is_ready = true;
                break;
            }
            default : {
                if ( /^\/[^/]+(\/(?:with_replies|media|likes))?\/?$/.test(pathname) ) {
                    bulk_download_is_ready = true;
                    bulk_download_likes_is_ready = true;
                }
                break;
            }
        }
        
        if ( bulk_download_is_ready ) {
            $bulk_download_button.on( 'click', ( $event ) => {
                if ( background_window.bulk_download_request ) {
                    background_window.bulk_download_request( active_tab_info.tab, 'media' );
                    window.close();
                }
                else {
                    chrome.runtime.sendMessage( {
                        type : 'BULK_DOWNLOAD_REQUEST_FROM_OPTIONS',
                        tab : active_tab_info.tab,
                        kind : 'media',
                    }, function ( response ) {
                        window.close();
                    } );
                }
            } );
            $bulk_download_button.show();
        }
        if ( bulk_download_likes_is_ready ) {
            $bulk_download_likes_button.on( 'click', ( $event ) => {
                if ( background_window.bulk_download_request ) {
                    background_window.bulk_download_request( active_tab_info.tab, 'likes' );
                    window.close();
                }
                else {
                    chrome.runtime.sendMessage( {
                        type : 'BULK_DOWNLOAD_REQUEST_FROM_OPTIONS',
                        tab : active_tab_info.tab,
                        kind : 'likes',
                    }, function ( response ) {
                        window.close();
                    } );
                }
            } );
            $bulk_download_likes_button.show();
        }
    }
    
    $( 'input[name="DEFAULT"]' ).click( async function () {
        await remove_values( OPTION_KEY_LIST );
        value_updated = true;
        
        await set_all_evt();
        //location.reload();
    } );
    
    
    STR_KV_LIST.forEach( function( str_kv ) {
        str_kv.val = chrome.i18n.getMessage( str_kv.key );
    } );
    
    $( '.i18n' ).each( function () {
        var jq_elm = $( this ),
            value = ( jq_elm.val() ) || ( jq_elm.html() ),
            text = chrome.i18n.getMessage( value );
        
        if ( ! text ) {
            return;
        }
        if ( ( value == 'OPTIONS' ) && ( jq_elm.parent().prop( 'tagName' ) == 'H1' ) ) {
            text += ' ( version ' + chrome.runtime.getManifest().version + ' )';
        }
        if ( jq_elm.val() ) {
            jq_elm.val( text );
        }
        else {
            jq_elm.html( text );
        }
    } );
    
    $( 'form' ).submit( function () {
        return false;
    } );
    
    
    function get_value( key ) {
        
        return new Promise( function ( resolve, reject ) {
            chrome.storage.local.get( key, function ( items ) {
                resolve( items[ key ] );
            } );
        } );
        
    } // end of get_value()
    
    
    function set_value( key, value ) {
        
        return new Promise( function ( resolve, reject ) {
            chrome.storage.local.set( {
                [ key ] : value
            }, function () {
                resolve();
            } );
        } );
        
    } // end of get_value()
    
    
    function remove_values( key_list ) {
        
        return new Promise( function ( resolve, reject ) {
            chrome.storage.local.remove( key_list, function () {
                resolve();
            } );
        } );
        
    } // end of remove_values()
    
    
    function get_bool( value ) {
        if ( value === undefined ) {
            return null;
        }
        if ( ( value === '0' ) || ( value === 0 ) || ( value === false ) || ( value === 'false' ) ) {
            return false;
        }
        if ( ( value === '1' ) || ( value === 1 ) || ( value === true ) || ( value === 'true' ) ) {
            return true;
        }
        return null;
    }  // end of get_bool()
    
    
    async function set_radio_evt( kv ) {
        function check_svalue( kv, svalue ) {
            var bool_value = get_bool( svalue );
            
            if ( bool_value === null ) {
                return check_svalue( kv, kv.val );
            }
            return ( bool_value ) ? '1' : '0';
        }
        
        var key = kv.key,
            svalue = check_svalue( kv, await get_value( key ) ),
            jq_target = $( '#' + key ),
            //jq_inputs = jq_target.find( 'input:radio' );
            jq_inputs = jq_target.find( 'input:radio[name="' + key + '"]' );
        
        jq_inputs.unbind( 'change' ).each( function () {
            var jq_input = $( this ),
                val = jq_input.val();
            
            if ( val === svalue ) {
                //jq_input.attr( 'checked', 'checked' );
                jq_input.prop( 'checked', 'checked' );
            }
            else {
                //jq_input.attr( 'checked', false );
                jq_input.prop( 'checked', false );
            }
            // ※ .attr() で変更した場合、ラジオボタンが書き換わらない場合がある(手動変更後に[デフォルトに戻す]を行った場合等)ので、.prop() を使用すること。
            //   参考：[jQueryでチェックボックスの全チェック／外しをしようとしてハマッたこと、attr()とprop()の違いは罠レベル | Ultraひみちゅぶろぐ](http://ultrah.zura.org/?p=4450)
        } ).change( async function () {
            var jq_input = $( this );
            
            await set_value( key, check_svalue( kv, jq_input.val() ) );
            value_updated = true;
        } );
    } // end of set_radio_evt()
    
    
    async function set_int_evt( kv ) {
        function check_svalue( kv, svalue ) {
            if ( isNaN( svalue ) ) {
                svalue = kv.val;
            }
            else {
                svalue = parseInt( svalue );
                if ( ( ( kv.min !== null ) && ( svalue < kv.min ) ) || ( ( kv.max !== null ) && ( kv.max < svalue ) ) ) {
                    svalue = kv.val;
                }
            }
            svalue = String( svalue );
            return svalue;
        }
        
        var key = kv.key,
            svalue = check_svalue( kv, await get_value( key ) ),
            jq_target = $( '#' + key ),
            jq_input = jq_target.find( 'input:text:first' ),
            jq_current = jq_target.find( 'span.current:first' );
        
        jq_current.text( svalue );
        jq_input.val( svalue );
        
        jq_target.find( 'input:button' ).unbind( 'click' ).click( async function () {
            var svalue = check_svalue( kv, jq_input.val() );
            
            await set_value( key, svalue );
            value_updated = true;
            
            jq_current.text( svalue );
            jq_input.val( svalue );
        } );
    } // end of set_int_evt()
    
    
    async function set_str_evt( kv ) {
        function check_svalue( kv, svalue ) {
            if ( ! svalue ) {
                svalue = kv.val;
            }
            else {
                svalue = String( svalue ).replace( /(?:^\s+|\s+$)/g, '' );
                if ( ! svalue ) {
                    svalue = kv.val;
                }
            }
            return svalue;
        }
        
        var key = kv.key,
            svalue = check_svalue( kv, await get_value( key ) ),
            jq_target = $( '#' + key ),
            jq_input = jq_target.find( 'input:text:first' ),
            jq_current = jq_target.find( 'span.current:first' );
        
        jq_current.text( svalue );
        jq_input.val( svalue );
        
        jq_target.find( 'input:button' ).unbind( 'click' ).click( async function () {
            var svalue = check_svalue( kv, jq_input.val() );
            
            await set_value( key, svalue );
            value_updated = true;
            
            jq_current.text( svalue );
            jq_input.val( svalue );
        } );
    } // end of set_str_evt()
    
    
    async function set_operation_evt() {
        var jq_operation = $( 'input[name="OPERATION"]' ),
            operation_key = 'OPERATION',
            operation = get_bool( await get_value( operation_key ) );
        
        if ( operation === null ) {
            operation = true; // デフォルトは true (動作中)
        }
        
        async function set_operation( next_operation ) {
            var button_text = ( next_operation ) ? ( chrome.i18n.getMessage( 'STOP' ) ) : ( chrome.i18n.getMessage( 'START' ) ),
                path_to_img = ( IS_EDGE ) ? 'img' : '../img',
                icon_path = ( next_operation ) ? ( path_to_img + '/icon_16.png' ) : ( path_to_img + '/icon_16-gray.png' );
            
            jq_operation.val( button_text );
            ( chrome.action || chrome.browserAction ).setIcon( { path : icon_path } );
            
            if ( next_operation ) {
                /*
                //if ( bulk_download_is_ready ) {
                //    $bulk_download_button.show();
                //}
                //if ( bulk_download_likes_is_ready ) {
                //    $bulk_download_likes_button.show();
                //}
                */
                // TODO: false → true のパターンだとページがリロードされないと正常に動かない
                // →暫定的にダウンロードボタンは非表示のままにしておく
            }
            else {
                $bulk_download_button.hide();
                $bulk_download_likes_button.hide();
            }
            await set_value( operation_key, next_operation );
            operation = next_operation;
        }
        
        jq_operation.unbind( 'click' ).click( async function( event ) {
            await set_operation( ! operation );
            value_updated = true;
        } );
        
        await set_operation( operation );
    } // end of set_operation_evt()
    
    
    async function set_all_evt() {
        for ( let radio_kv of RADIO_KV_LIST ) {
            await set_radio_evt( radio_kv );
        }
        
        for ( let int_kv of INT_KV_LIST ) {
            await set_int_evt( int_kv );
        }
        
        for ( let str_kv of STR_KV_LIST ) {
            await set_str_evt( str_kv );
        }
        
        await set_operation_evt();
        
    }   //  end of set_all_evt()
    
    
    await set_all_evt();
    
    
    $( 'input[name="DEFAULT"]' ).click( async function () {
        await remove_values( OPTION_KEY_LIST );
        value_updated = true;
        
        await set_all_evt();
        //location.reload();
    } );

} );

} )( window, document );

// ■ end of file
