// extlibs
var fs = require('fs');
var http = require('http');
var moment = require('moment');
var Q = require("q");
var _ = require("underscore");

// Our stuff
var fuzzy = require('./fuzzy_match.js');
var league = require("./league.js");
var players = require("./player.js");
var spreadsheets = require('./spreadsheets.js');
var slack = require('./slack.js');
var users = slack.users;
var channels = slack.channels;
var lichess = require('./lichess.js');

/* exception handling */
/* later this will move it its own module */

function exception_handler(todo, on_error){
    try{
       todo();
    }catch(e){
        var error_log = "An error occurred:" +
            "\nDatetime: " + new Date() +
            "\nError: " + JSON.stringify(e) +
            "\nStack: " + e.stack;
        console.error(error_log);
        on_error && on_error();
    }
}

function bot_exception_handler(bot, message, todo){
    exception_handler(todo, function(){
        console.log("Message: " + JSON.stringify(message));
        bot.reply(message, "Something has gone terribly terribly wrong. Please forgive me.");
    });
}

function critical_path(todo){
    exception_handler(todo, function(){
        console.log("An exception was caught in a critical code-path. I am going down.");
        process.exit(1);
    });
}

/* static entry point */

var config_file = process.argv[2] || "./config.js"; 
var chesster = new slack.Bot({
    config_file: config_file
});

// A helper for a very common pattern
function leagueResponse(patterns, responseName) {
    chesster.hears({
        middleware: [slack.requiresLeague],
        patterns: patterns,
        messageTypes: [
            'direct_message',
            'direct_mention'
        ]
    },
    function (bot, message){
        return message.league[responseName]().then(function(response) {
            bot.reply(message, response);
        });
    });
}

/* stop giritime */
chesster.hears({
    patterns: 'giritime',
    messageTypes: [
        'ambient'
    ]
},
function(bot,message) {
    var response = "Stop... Giri Time!\n" + "Hi! Im Chesster. Ill be your new bot. " + 
                    "To interact with me, mention " + slack.users.getIdString("chesster") + 
                    " in a message";
    bot.reply(message, response);
});

/* captains */
leagueResponse(['captain guidelines'], 'formatCaptainGuidelinesResponse');
leagueResponse(['captains', 'captain list'], 'formatCaptainsResponse');


/* rating */

chesster.controller.hears([
    players.appendPlayerRegex("rating", true)	
],[
	'direct_mention', 
	'direct_message'
],function(bot,message) {
    bot_exception_handler(bot, message, function(){
        var player_name = players.getSlackUser(users, message).name;
        getRating(player_name, function(rating){
            if(rating){
                bot.reply(message, prepareRatingMessage(player_name, rating));
            }else{
                bot.reply(message, "I am sorry. I could not find that player.");
            }
        });
    });
});

function getRating(player, callback){
    getPlayerByName(player, function(error, opponent){
        if(opponent){
            getClassicalRating(opponent, callback);
        }else{
            console.error(JSON.stringify(error));
            callback();
        }
    });
}

function prepareRatingMessage(player, rating, convo){
    return player + " is rated " + rating + " in classical chess";
}

/* commands */

function prepareCommandsMessage(){
    return "I will respond to the following commands when they are spoken to " + 
									  users.getIdString("chesster") + ": \n```" +
        "    [ help ]                       ! display an interactive guide\n" +
        "    [ starter guide ]              ! get the starter guide link; thanks GnarlyGoat!\n" +
        "    [ rules | regulations ]        ! get the rules and regulations.\n" + 
        "    [ pairings | standings ]       ! get pairings/standings spreadsheet link\n" +
        "    [ channels | \n" +
        "        channel list |             ! list the important channels\n" +
        "        channel detail <channel> ] ! details regarding #<channel>\n" +
        "    [ commands | \n"  +
        "        command list ]             ! this list\n" +
        "    [ rating <player> ]            ! get the player's classical rating.\n" +
/*        "    [ challenge <opp1> <opp2> <w|b|r> <tc-min>+<tc-inc> <[un]rated> ]" +
        "                                   ! this command will create a <rated|casual> challenge between\n" +
        "                                   ! two opponents <opp1> <opp2> \n" +
        "                                   ! opponent one being colored <w|b|r> and \n" +
        "                                   ! time control <tc-min> with a <tc-inc> increment \n" +*/
        "    [ teams | \n" +
        "        team list |                ! list the teams in the current tournament\n" +
        "        team stats <team-name> |   ! get statistics for a given <team-name>\n" +
        "        team members <team-name> | ! list the members of a given <team-name>\n" +
        "        team captain <team-name> ] ! name the captain of a given <team-name>\n" +
        "    [ captains | \n" +
        "        captain list |             ! list the team captains\n" +
        "        captain guidelines ]       ! get the team captain guidelines\n" +
        "    [ board <number> ]             ! get a sorted list of players by board\n" +
        "    [ feedback <feedback>]         ! send @chesster some feedback (bug reports, \n" +
        "                                   ! suggestions, gratitude, etc)\n" +
        "    [ mods (lonewolf)| \n"  +
        "        mod list (lonewolf)|       ! list the mods (without summoning)\n" +
        "        mods summon (lonewolf)]    ! summon the mods\n" +
        "    [ faq ]                        ! a document of frequently asked questions\n" + 
        "    [ registration | sign up ]     ! registration form to play in our league\n" +
        "    [ source ]                     ! github repo for Chesster \n" +
        "```\n";
}

chesster.hears({
    patterns: [
        'commands', 
        'command list',
        'help',
    ],
    messageTypes: [
        'direct_mention', 
        'direct_message'
    ]
},
function(bot,message) {
    bot.startPrivateConversation(message, function (response, convo) {
        convo.say(prepareCommandsMessage());
    });
});

/* mods */

function prepareSummonModsMessage(){
    return "Summoning mods:" + 
        users.getIdString("endrawes0") + ", " +
        users.getIdString("mkoga") + ", " +
        users.getIdString("mrlegilimens") + ", " +
        users.getIdString("petruchio") + ", " +
        users.getIdString("seb32") + ", " +
        users.getIdString("theino");
}

function prepareSummonLoneWolfModsMessage(){
    return "Summoning LoneWolf mods:" + 
        users.getIdString("endrawes0") + ", " +
        users.getIdString("lakinwecker") + ", " +
        users.getIdString("theino");
}

/*
 * The funky character in theinos name is a zero-width-space:
 * https://en.wikipedia.org/wiki/Zero-width_space
 *
 * It prevents slack from notifying him, but actually doesn't get
 * copy/pasted so if someone copies his name and then pastes it, it
 * works fine.
 */
function prepareModsMessage(){
    return "Mods: endrawes0, mkoga, mrlegilimens, petruchio, seb32, t\u200Bheino";
}

function prepareLoneWolfModsMessage(){
    return "LoneWolf mods: endrawes0, lakinwecker, t\u200Bheino";
}

chesster.controller.hears([
    "^mods$",
    "^mods (.*)$",
    "^(.*) mods (.*)$",
    "^(.*) mods$"
], [
    'direct_mention', 
    'direct_message'
], function(bot, message) {
    bot_exception_handler(bot, message, function(){
        var args = message.match.slice(1).join(" ");
        var results = fuzzy.match(message, ["list", "summon"], channels.byId, args);
        var command = results.command;
        var target = results.target;
        if (!target) {
            console.log("Error determining which tournament to target for mods command");
        } else if (target == "team") {
            if (command == "list") {
                bot.reply(message, prepareModsMessage());
            } else if (command == "summon") {
                bot.reply(message, prepareSummonModsMessage());
            }
        } else if (target == "lonewolf") {
            if (command == "list") {
                bot.reply(message, prepareLoneWolfModsMessage());
            } else if (command == "summon") {
                bot.reply(message, prepareSummonLoneWolfModsMessage());
            }
        } else {
            console.log("Unable to determine target");
        }
    });
});

/* help */

/* channels */
function prepareChannelListMessage(){
    return "You may find the following channels useful:\n" +
        "\t" + channels.getIdString("general") + "\n" +
        "\t" + channels.getIdString("team-scheduling") + "\n" +
        "\t" + channels.getIdString("team-gamelinks") + "\n" +
        "\t" + channels.getIdString("team-results") + "\n" +
        "\t" + channels.getIdString("team-scheduling") + "\n" +
        "\t" + channels.getIdString("team-gamelinks") + "\n" +
        "\t" + channels.getIdString("team-results") + "\n" +
        "\t" + channels.getIdString("random") + "\n" +
        "Try: [ @chesster channel details <channel name> ] for more detail.";
}

function sayChannels(convo){
    convo.say(prepareChannelListMessage());
}

function prepareChannelDetailMessage(channel){
    var CHANNEL_DETAILS = {
        "general": channels.getIdString("general") + " is used to communicate news to members of " + 
			"the league. Any general league discussion can be done there. If conversation is not " +
			"league related, please go to " + channels.getIdString("random") + 
			" or create a new channel.",
        "team-scheduling": "Put the time of your scheduled games here." + 
			"\n\tFormat: \"@white v @black, mm/dd @ HH:MM\" (all times GMT)",
        "team-gamelinks": "Post links to lichess, league games here.",
        "team-results": "Post results here."
			+ "\n\tFormat: \"@white v @black, <result>\", where <result> in {1-0, 1/2-1/2, 0-1}",
        "random": "Anything can be discussed here. " + 
			"And if it is not league related, it belongs in here.",
        "default": "I am sorry. I do not recognize that channel.",
    };

    channel = channel.replace("#", ""); //remove channel special character
    return CHANNEL_DETAILS[channel] || CHANNEL_DETAILS["default"] + ": " + channel;
}

chesster.controller.hears([
	'channels', 
	'channel list'
],[
	'direct_mention', 
	'direct_message'
],function(bot, message) {
    bot_exception_handler(bot, message, function(){
        var self = this;
        bot.reply(message, prepareChannelListMessage());
    });
});

chesster.controller.hears([
	'channel detail'
],[
	'direct_mention'
],function(bot, message) {
    bot_exception_handler(bot, message, function(){
        var channel_name = message.text.split(" ").slice(2).join(" ");
        bot.reply(message, prepareChannelDetailMessage(channel_name));
    });
});


/* pairings */
leagueResponse(['pairings', 'standings'], 'formatPairingsLinkResponse');

chesster.hears({
    patterns: [
        players.appendPlayerRegex("pairing", true)
    ],
    messageTypes: [
        'direct_mention', 'direct_message'
    ]
}, function(bot, message) {
    var targetPlayer = players.getSlackUser(users, message);
    var deferred = Q.defer();
    var allLeagues = league.getAllLeagues(chesster.config);
    bot.startPrivateConversation(message, function (response, convo) {
        Q.all(
            _.map(allLeagues, function(l) {
                return l.getPairingDetails(targetPlayer).then(function(details) {
                    if (details && details.opponent) {
                        return l.formatPairingResponse(message.player, details).then(function(response) {
                            convo.say(response);
                        });
                    } else {
                        convo.say("[" + l.options.name + "] Unable to find pairing for " + targetPlayer.name);
                    }
                }, function(error) {
                    console.log("error");
                    console.error(JSON.stringify(error));
                });
            })
        ).then(function(results) {
            deferred.resolve();
        }, function(error) {
            deferred.reject(error);
        });
    });
    return deferred.promise;
});

chesster.hears({
    middleware: [slack.requiresLeague, slack.requiresModerator],
    patterns: [
        'debug'
    ],
    messageTypes: [
        'direct_mention', 'direct_message'
    ]
}, function(bot, message) {
    return message.league.formatDebugResponse().then(function(reply) {
        bot.reply(message, reply);
    });
});

/* rules */
leagueResponse(['rules', 'regulations'], 'formatRulesLinkResponse');

/* exceptions */

chesster.hears({
    patterns: "exception handle test",
    messageTypes: [
        "ambient"
    ]
},
function(bot, message){
    throw new Error("an error");
});

/* teams */

chesster.hears({
    middleware: [slack.requiresLeague],
    patterns: 'team captain',
    messageTypes: [
        'direct_mention', 
        'direct_message'
    ]
},
function(bot, message) {
    var teamName = message.text.split(" ").slice(2).join(" ");
    return message.league.formatTeamCaptainResponse(teamName).then(function(response) {
        bot.reply(message, response);
    });
});

leagueResponse(['teams', 'team list'], 'formatTeamsResponse');


/* team members */
chesster.hears({
    middleware: [slack.requiresLeague],
	patterns: ['team members'],
    messageTypes: [
        'direct_mention', 
        'direct_message'
    ]
},
function(bot, message) {
    return Q.fcall(function() {
        var teamName = message.text.split(" ").slice(2).join(" ");
        if(teamName && teamName != ""){
            message.league.formatTeamMembersResponse(teamName).then(function(response) {
                bot.reply(message, response);
            });
        }else{
            bot.reply(message, "Which team did you say? [ team members <team-name> ]. Please try again.");
        }
    });
});

/* LICHESS STUFF */

function getPlayerByName(name, callback){
    var url = "http://en.lichess.org/api/user/" + name;
    fetch_url_into_json(url, callback);
}

function getClassicalRating(opp, callback){
  callback(opp.perfs.classical.rating);
}

/* welcome */

chesster.controller.on('user_channel_join', function(bot, message) {
    bot_exception_handler(bot, message, function(){
        if(message.channel == channels.getId("general")){
            bot.reply(message, "Everyone, please welcome the newest member of the " 
                             + "Lichess 45+45 League, <@" + message.user + ">!");
            
            bot.startPrivateConversation(message, function(err, convo){
                // TODO: the config links references below are hard coded
                //       to the 45+45 league. Eventually, we'll want to fix that
                //       but I'm not taking on that task right now.
                convo.say("Hi <@" + message.user + ">, \n" 
                        + "\tIt seems you are new here. " 
                        + "We are happy to have you join the Lichess 45+45 League.\n"
                        + "\tMy name is Chesster. I am a bot. " 
                        + "I was created to help moderate the league. " 
                        + "It is my job to welcome you and to share with you " 
                        + "some resources with which you should familiarize yourself.\n" 
                        + "\tPlease read our Starter Guide and Rules documents. " 
                        + "They will give you a better idea how this league works.\n" 
                        + "\tIf you have not already, I suggest downloading the Slack App: " 
                        + "https://slack.com/downloads so you can stay " 
                        + "connected with the league. It is the easiest way for most "
                        + "of us to communicate and you will find that many of us "
                        + "are active in this community every day. Make yourself at home.");
                convo.say(chesster.config["leagues"]["45+45"].links.guide);
                convo.say(chesster.config["leagues"]["45+45"].links.rules);
                convo.say("\tIf there is anything else I can help you with, do not hesitate to ask. " 
                        + "You can send me a direct message in this private channel. " 
                        + "Just say `commands` to see a list of ways that I can help you.\n" 
                        + "\tIf there is ANYTHING else, dont hesitate to reach out to the moderators. " 
                        + "We love to help out. Say `mods` to get a list.");
            });
        }
    });
});

leagueResponse(['welcome', 'starter guide', 'player handbook'], 'formatStarterGuideResponse');

/* feedback */

chesster.controller.hears([
	"feedback"
], [
	"direct_mention"
], function(bot, message){
    bot_exception_handler(bot, message, function(){
        bot.reply(message, "As a computer, I am not great at understanding tone. Whether this was positive, negative, constructive or deconstructive feedback, I cannot tell. But regardless, I am quite glad you took the time to leave it for me. \n\nWith love and admiration,\nChesster.");
        var feedback_log = "Received new feedback:" + 
                           "\nMessage: " + JSON.stringify(message) + "\n\n";
       fs.appendFile("./feedback_log", feedback_log, function(err) {
            if(err) {
                console.log("failed to write to the file...")
                console.log(feedback_log);
                console.log(err);
                throw new Error("Failed to log feedback: " + feedback_log);
            }
        });
    });
});

chesster.hears({
    patterns: ['thanks', 'thank you'],
    messageTypes: [
        'direct_mention', 
        'mention', 
        'direct_message'
    ]
},
function(bot,message) {
    bot.reply(message, "It is my pleasure to serve you!");
});

/* registration */
leagueResponse(['registration', 'register', 'sign up', 'signup'], 'formatRegistrationResponse');


/* challenges */

//http --form POST en.l.org/setup/friend?user=usernameOrId variant=1 clock=false time=60 increment=60 color=random 'Accept:application/vnd.lichess.v1+json'

chesster.controller.hears([
	'challenge'
], [
	'direct_mention', 
	'direct_message'
], function(bot,message) {
    bot_exception_handler(bot, message, function(){
    });
});

/* source */

chesster.hears({
    patterns: "source",
    messageTypes: [
        'direct_message',
        'direct_mention'
    ]
},
function(bot, message){
    bot.reply(message, chesster.config.links.source);
});

/* board */

chesster.hears({
    middleware: [slack.requiresLeague],
    patterns: ['board'],
    messageTypes: [
        'direct_mention', 
        'direct_message'
    ]
},
function(bot, message) {
    var deferred = Q.defer();
    bot.startPrivateConversation(message, function (response, convo) {
        boardNumber = parseInt(message.text.split(" ")[1]);
        if(boardNumber && !isNaN(boardNumber)){
            message.league.formatBoardResponse(boardNumber).then(function(response) {
                convo.say(response);
                deferred.resolve();
            });
        }else{
            convo.say("Which board did you say? [ board <number> ]. Please try again.");
            deferred.resolve();
        }
    });
    return deferred.promise;
});



/* Scheduling */

// Scheduling reply helpers

// Can't find the pairing
function scheduling_reply_missing_pairing(bot, message) {
    var user = "<@"+message.user+">";
    bot.reply(message, ":x: " + user + " I couldn't find your pairing. Please use a format like: @white v @black 04/16 @ 16:00");
}

// you are very close to the cutoff
function scheduling_reply_close_to_cutoff(bot, message, scheduling_options, white, black) {
    bot.reply(message, 
        ":heavy_exclamation_mark: @" + white.name + " " + "@" + black.name + " " + scheduling_options.warning_message
    );
}

// Game has been scheduled.
function scheduling_reply_scheduled(bot, message, results, white, black) {
    var whiteDate = results.date.clone().utcOffset(white.tz_offset/60);
    var blackDate = results.date.clone().utcOffset(black.tz_offset/60);
    var format = "YYYY-MM-DD @ HH:mm UTC";
    var friendly_format = "ddd @ HH:mm";
    var dates = [
        results.date.format(format) + " ",
        whiteDate.format(friendly_format) + " for " + white.name,
        blackDate.format(friendly_format) + " for " + black.name,
    ];
    date_formats  = dates.join("\n\t");

    bot.reply(message, 
        ":heavy_check_mark: @" + white.name + " (_white pieces_) vs " + "@" + black.name + " (_black pieces_) scheduled for: \n\t" + date_formats
    );
}


// Your game is out of bounds
function scheduling_reply_too_late(bot, message, scheduling_options) {
    var user = "<@"+message.user+">";
    bot.reply(message, ":x: " + user + " " + scheduling_options.late_message);
}

// can't find the users you menteiond
function scheduling_reply_cant_schedule_others(bot, message) {
    var user = "<@"+message.user+">";
    bot.reply(message, ":x: " + user + " you may not schedule games for other people. You may only schedule your own games.");
}

// can't find the users you menteiond
function scheduling_reply_cant_find_user(bot, message) {
    var user = "<@"+message.user+">";
    bot.reply(message, ":x: " + user + " I don't recognize one of the players you mentioned.");
}

// Scheduling will occur on any message
chesster.controller.on('ambient', function(bot, message) {
    bot_exception_handler(bot, message, function(){
        var channel = channels.byId[message.channel];
        if (!channel) {
            return;
        }
        var scheduling_options = chesster.config.scheduling[channel.name];
        if (!scheduling_options) {
            return;
        } 

        var is_potential_schedule = false;
        var references_slack_users = false;
        var has_pairing = false;

        var results = {
            white: '',
            black: ''
        };

        // Step 1. See if we can parse the dates
        try {
            results = spreadsheets.parse_scheduling(message.text, scheduling_options);
            is_potential_schedule = true;
        } catch (e) {
            if (e instanceof (spreadsheets.ScheduleParsingError)) {
            } else {
                throw e; // let others bubble up
            }
        }

        // Unless they included a date we can parse, ignore this message.
        if (!is_potential_schedule) {
            return;
        }

        // Step 2. See if we have valid named players
        var white = users.getByNameOrID(results.white);
        var black = users.getByNameOrID(results.black);
        if (white && black) {
            results.white = white.name;
            results.black = black.name;
            references_slack_users = true;
        }


        // Step 3. attempt to update the spreadsheet
        spreadsheets.update_schedule(
            chesster.config.service_account_auth,
            scheduling_options.key,
            scheduling_options.colname,
            scheduling_options.format,
            results,
            function(err, reversed) {
                if (err) {
                    if (err.indexOf && err.indexOf("Unable to find pairing.") == 0) {
                        has_pairing = false;
                    } else {
                        bot.reply(message, "Something went wrong. Notify @lakinwecker");
                        throw new Error("Error updating scheduling sheet: " + err);
                    }
                } else {
                    has_pairing = true;
                }
                if (reversed) {
                    var tmp = white;
                    white = black;
                    black = tmp;
                }

                if (!references_slack_users) {
                    scheduling_reply_cant_find_user(bot, message);
                    return;
                }
                var speaker = users.getByNameOrID(message.user);
                if (white.id != speaker.id && black.id != speaker.id) {
                    scheduling_reply_cant_schedule_others(bot, message);
                    return;
                }
                if (!has_pairing) {
                    scheduling_reply_missing_pairing(bot, message);
                    return;
                }
                if (results.out_of_bounds) {
                    scheduling_reply_too_late(bot, message, scheduling_options);
                    return;
                }
                if (results.warn) {
                    scheduling_reply_close_to_cutoff(bot, message, scheduling_options, white, black);
                }
                scheduling_reply_scheduled(bot, message, results, white, black);
            }
        );
    });
});



/* results parsing */

// results processing will occur on any message
chesster.controller.on('ambient', function(bot, message) {
    bot_exception_handler(bot, message, function(){
        var channel = channels.byId[message.channel];
        if (!channel) {
            return;
        }
        var results_options = chesster.config.results[channel.name];
        if (!results_options) {
            return;
        }
        try{
            var result = spreadsheets.parse_result(message.text);
     
            if(!result.white || !result.black || !result.result){
		return;
            }

            result.white = users.getByNameOrID(result.white.replace(/[\<\@\>]/g, ''));
            result.black = users.getByNameOrID(result.black.replace(/[\<\@\>]/g, ''));
            
            if(result.white.id != message.user && result.black.id != message.user){
                reply_permission_failure(bot, message);
                return;
            }

            //this could and probably should be improved at some point
            //this will require two requests to the spread sheet and
            //it can be done in one, but I am trying to reuse what 
            //I wrote before as simply as possibe for now

            //if a gamelink already exists, get it
            spreadsheets.fetch_pairing_gamelink(
                chesster.config.service_account_auth,
                results_options.key,
                results_options.colname,
                result,
                function(err, gamelink){
                    //if a gamelink is found, use it to acquire details and process them
                    if(!err && gamelink){
                        process_gamelink(
                            bot, 
                            message, 
                            gamelink, 
                            chesster.config.gamelinks[channel.name], 
                            result); //user specified result
                    }else{
                        //update the spreadsheet with result only
                        spreadsheets.update_result(
                            chesster.config.service_account_auth,
                            results_options.key,
                            results_options.colname,
                            result,
                            function(err, reversed){
                                if (err) {
                                    if (err.indexOf && err.indexOf("Unable to find pairing.") == 0) {
                                        result_reply_missing_pairing(bot, message);
                                    } else {
                                        bot.reply(message, "Something went wrong. Notify @endrawes0");
                                        throw new Error("Error updating scheduling sheet: " + err);
                                    }
                                } else {
                                    result_reply_updated(bot, message, result);
                                }
                            }
                        );
                    }
                }
            );

        }catch(e){
            //at the moment, we do not throw from inside the api - rethrow
            throw e;
        }
    });
});

function reply_permission_failure(bot, message){
    bot.reply(message, "Sorry, you do not have permissin to update that pairing.");
}

function result_reply_missing_pairing(bot, message){
    bot.reply(message, "Sorry, I could not find that pairing.");
}

function result_reply_updated(bot, message, result){
    bot.reply(message, "Got it. @" + result.white.name + " " + result.result + " @" + result.black.name);
}



/* game link parsing */

//given a gamelink_id, use the lichess api to get the game details
//pass the details to the callback as a JSON object
function fetch_game_details(gamelink_id, callback){
    fetch_url_into_json("http://en.lichess.org/api/game/" + gamelink_id, callback);
}

function fetch_url_into_json(url, callback){
    const http = require('http');
    http.get(url, (res) => {
        var body = "";
        res.on('data', function (chunk) {
            body += chunk;
        });
        res.on('end', () => {
            if(body != ""){
                var json = JSON.parse(body);
                if(json){
                   callback(undefined, json);
                }else{
                   callback("body was not a valid JSON object");
                }
            }else{
                callback("body was empty from url: " + url);
            }
        });
    }).on('error', (e) => {
        console.error(JSON.stringify(e));
        callback("failed to get a response from url: " + url);
    });
}

//verify the game meets the specified parameters in options
function validate_game_details(details, options){
    var result = {
        valid: true,
        reason: "",
    };
    if(details.rated != options.rated){
        //the game is not rated correctly
        result.valid = false;
        result.reason = "the game is " + ( options.rated ? "unrated." : "rated." );
    }else if( !details.clock || ( // no clock - unlimited or coorespondence
        details.clock && ( //clock
            details.clock.initial != options.clock.initial * 60 || // initial time
            details.clock.increment != options.clock.increment ) // increment
        ) 
    ){
        //the time control does not match options
        result.valid = false;
        result.reason = "the time control is incorrect."
    }else if(details.variant != options.variant){
        //the variant does not match
        result.valid = false;
        result.reason = "the variant should be standard."
    }else{
        //the link is too old or too new
        var extrema = spreadsheets.get_round_extrema(options);
        var game_start = moment.utc(details.timestamp);
        if(game_start.isBefore(extrema.start) || game_start.isAfter(extrema.end)){
            result.valid = false;
            result.reason = "the game was not played in the current round.";
        }
    }
    return result;
}

function gamelink_reply_invalid(bot, message, reason){
    bot.reply(message, "I am sorry, <@" + message.user + ">,  "
                     + "your post is *not valid* because "
                     + "*" + reason + "*");
    bot.reply(message, "If this was a mistake, please correct it and "
                     + "try again. If intentional, please contact one "
                     + "of the moderators for review. Thank you.");
}

function reply_generic_failure(bot, message, contact){
    bot.reply(message, "Something went wrong. Notify " + contact);
}

function gamelink_reply_unknown(bot, message){
    bot.reply(message, "Sorry, I could not find that game. Please verify your gamelink.");
}

function validate_user_result(details, result){
    //if colors are reversed, in the game link, we will catch that later
    //we know the players are correct or we would not already be here
    //the only way we can validate the result is if the order is 100% correct.
    var validity = {
        valid: true,
        reason: ""
    };
    if( details.winner && result.result == "1/2-1/2" ){
        //the details gave a winner but the user claimed draw
        validity.reason = "the user claimed a draw " 
                        + "but the gamelink specifies " + details.winner + " as the winner.";
        validity.valid = false;
   }else if( details.winner == "black" && result.result == "1-0"){
        //the details gave the winner as black but the user claimed white
        validity.reason = "the user claimed a win for white " 
                        + "but the gamelink specifies black as the winner.";
        validity.valid = false;
    }else if( details.winner == "white" && result.result == "0-1"){
        //the details gave the winner as white but the user claimed black
        validity.reason = "the user claimed a win for black " 
                        + "but the gamelink specifies white as the winner.";
        validity.valid = false;
    }else if( details.status == "draw" && result.result != "1/2-1/2" ){
        //the details gave a draw but the user did not claim a draw
        validity.reason = "the user claimed a decisive result " 
                        + "but the gamelink specifies a draw.";
        validity.valid = false;
    }
    return validity;
}

function process_gamelink(bot, message, gamelink, options, user_result){
    //get the gamelink id if one is in the message
    var result = spreadsheets.parse_gamelink(gamelink);
    if(!result.gamelink_id){
        //no gamelink found. we can ignore this message
        return;
    }
    //get the game details
    fetch_game_details(result.gamelink_id, function(error, details){
        //validate the game details vs the user specified result
        if(details){
            if(user_result){
                var validity = validate_user_result(details, user_result);
                if(!validity.valid){
                    gamelink_reply_invalid(bot, message, validity.reason);
                    return;
                }
            }
            process_game_details(bot, message, details, options);
        }else{
            console.error(JSON.stringify(error));
            bot.reply(message, "Sorry, I failed to get game details for " + gamelink + ". Try again later or reach out to a moderator to make the update manually.");
        }
    });
}

function process_game_details(bot, message, details, options){
    //if no details were found the link was no good
    if(!details){
        gamelink_reply_unknown(bot, message);
        return;
    }

    //verify the game meets the requirements of the channel we are in
    var validity = validate_game_details(details, options);
    if(!validity.valid){
        //game was not valid
        gamelink_reply_invalid(bot, message, validity.reason);
        return;
    }
    var result = {};
    //our game is valid
    //get players to update the result in the sheet
    var white = details.players.white;
    var black = details.players.black;
    result.white = users.getByNameOrID(white.userId);
    result.black = users.getByNameOrID(black.userId);
    result.gamelink_id = details.id;
 
    //get the result in the correct format
    if(details.status == "draw" || details.winner){
        if(details.winner == "black"){
            result.result = "0-1";
        }else if(details.winner == "white"){
            result.result = "1-0";
        }else{
            result.result = "1/2-1/2";
        }
    }else{
        result.result = "\u2694";
    }
    //gamelinks only come from played games, so ignoring forfeit result types

    //update the spreadsheet with results from gamelink
    spreadsheets.update_result(
        chesster.config.service_account_auth,
        options.key,
        options.colname,
        result,
        function(err, reversed){
            if (err) {
                if (err.indexOf && err.indexOf("Unable to find pairing.") == 0) {
                    result_reply_missing_pairing(bot, message);
                }else if(reversed){
                    gamelink_reply_invalid(bot, message, err);
                }else{
                    reply_generic_failure(bot, message, "@endrawes0");
                    throw new Error("Error updating scheduling sheet: " + err);
                }
            } else {
                result_reply_updated(bot, message, result);
            }
        }
    );
}

// gamelink processing will occur on any message
chesster.controller.on('ambient', function(bot, message) {
    bot_exception_handler(bot, message, function(){
        var channel = channels.byId[message.channel];
        if (!channel) {
            return;
        }
        if (!chesster.config.gamelinks) {
            return;
        }
        //get the configuration for the channel
        var gamelinks_options = chesster.config.gamelinks[channel.name];
        if (!gamelinks_options) {
            //drop messages that are not in a gamelink channel
            return;
        }
        try{
            process_gamelink(bot, message, message.text, gamelinks_options);
        }catch(e){
            //at the moment, we do not throw from inside the api - rethrow
            throw e;
        }
    });
});

