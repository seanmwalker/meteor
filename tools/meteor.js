var Fiber = require('fibers');
Fiber(function () {

  var path = require('path');
  var files = require(path.join(__dirname, 'files.js'));
  var _ = require('underscore');
  var deploy = require(path.join(__dirname, 'deploy'));
  var fs = require("fs");
  var runner = require(path.join(__dirname, 'run.js'));
  var packages = require(path.join(__dirname, 'packages.js'));
  var project = require(path.join(__dirname, 'project.js'));
  var warehouse = require(path.join(__dirname, 'warehouse.js'));

  var die = function (msg) {
    console.error(msg);
    process.exit(1);
  };

  // This code is duplicated in app/server/server.js.
  var MIN_NODE_VERSION = 'v0.8.18';
  if (require('semver').lt(process.version, MIN_NODE_VERSION)) {
    process.stderr.write(
      'Meteor requires Node ' + MIN_NODE_VERSION + ' or later.\n');
    process.exit(1);
  }

  var Commands = [];

  var usage = function() {
    process.stdout.write(
      "Usage: meteor [--version] [--help] <command> [<args>]\n" +
        "\n" +
        "With no arguments, 'meteor' runs the project in the current\n" +
        "directory in local development mode. You can run it from the root\n" +
        "directory of the project or from any subdirectory.\n" +
        "\n" +
        "Use 'meteor create <name>' to create a new Meteor project.\n" +
        "\n" +
        "Commands:\n");
    _.each(Commands, function (cmd) {
      if (cmd.help) {
        var name = cmd.name + "                ".substr(cmd.name.length);
        process.stdout.write("   " + name + cmd.help + "\n");
      }
    });
    process.stdout.write("\n");
    process.stdout.write(
      "See 'meteor help <command>' for details on a command.\n");
    process.exit(1);
  };

  // If the releases directory in local warehouse is empty, fetch the
  // latest release from our servers. This release may require a
  // different tools, in which case we'll springboard later.
  var ensureSomeRelease = function () {
    if (!warehouse.latestRelease()) {
      warehouse.fetchLatestRelease();
    }
  };

  // Stores the app directory (if any), release version, etc.
  var context = {};

  // Figures out if we're in an app dir, what release we're using, etc. May
  // download the release if necessary.
  var calculateContext = function (argv) {
    var appDir = files.findAppDir();
    context.appDir = appDir && path.resolve(appDir);

    if (context.appDir) {
      context.appReleaseVersion =
        project.getMeteorReleaseVersion(context.appDir);
    }

    context.releaseVersion = calculateReleaseVersion(argv);
    toolsDebugMessage("Running Meteor Release " + context.releaseVersion);
    context.releaseManifest =
      warehouse.releaseManifestByVersion(context.releaseVersion);
    context.packageSearchOptions = {
      appDir: context.appDir,
      releaseManifest: context.releaseManifest
    };
  };

  var calculateReleaseVersion = function (argv) {
    if (!files.usesWarehouse()) {
      if (argv.release) {
        die("Can't specify a release when running Meteor from a checkout.");
      }
      // The release in a git checkout is called "none" and is hardcoded in
      // warehouse.js to have no packages.
      return 'none';
    }

    ensureSomeRelease();

    // If a release was specified explicitly on the command line, that's the one
    // to use. Otherwise use the release specified in the app (if
    // any). Otherwise use the latest release.

    return argv.release ||
      context.appReleaseVersion ||
      warehouse.latestRelease();
  };

  // If we're not in an app directory, die with an error message.
  //
  // @param cmd {String} The command that was run. Used when printing
  //   error message.
  var requireDirInApp = function (cmd) {
    if (context.appDir)
      return;
    // This is where you end up if you type 'meteor' with no args. Be gentle to
    // the noobs..
    die(cmd + ": You're not in a Meteor project directory.\n" +
        "\n" +
        "To create a new Meteor project:\n" +
        "   meteor create <project name>\n" +
        "For example:\n" +
        "   meteor create myapp\n" +
        "\n" +
        "For more help, see 'meteor --help'.");
  };

  var find_mongo_port = function (cmd, callback) {
    requireDirInApp(cmd);
    var mongo_runner = require(path.join(__dirname, 'mongo_runner.js'));
    mongo_runner.find_mongo_port(context.appDir, callback);
  };

  var findCommand = function (name) {
    for (var i = 0; i < Commands.length; i++)
      if (Commands[i].name === name)
        return Commands[i];
    process.stdout.write("'" + name + "' is not a Meteor command. See " +
                         "'meteor --help'.\n");
    process.exit(1);
  };

  // XXX when the pass unexpected argument or unrecognized flags, print
  // an error and fail out

  Commands.push({
    name: "run",
    help: "[default] Run this project in local development mode",
    func: function (argv) {
      // reparse args
      // This help logic should probably move to run.js eventually
      var opt = require('optimist')
            .alias('port', 'p').default('port', 3000)
            .describe('port', 'Port to listen on. NOTE: Also uses port N+1 and N+2.')
            .boolean('production')
            .describe('production', 'Run in production mode. Minify and bundle CSS and JS files.')
            .describe('settings',  'Set optional data for Meteor.settings on the server')
            // #Once
            // With --once, meteor does not re-run the project if it crashes and
            // does not monitor for file changes. Intentionally undocumented:
            // intended for automated testing (eg, cli-test.sh), not end-user
            // use.
            .boolean('once')
            .usage(
              "Usage: meteor run [options]\n" +
                "\n" +
                "Searches upward from the current directory for the root directory of a\n" +
                "Meteor project, then runs that project in local development\n" +
                "mode. You can use the application by pointing your web browser at\n" +
                "localhost:3000. No internet connection is required.\n" +
                "\n" +
                "Whenever you change any of the application's source files, the changes\n" +
                "are automatically detected and applied to the running application.\n" +
                "\n" +
                "The application's database persists between runs. It's stored under\n" +
                "the .meteor directory in the root of the project.\n");

      var new_argv = opt.argv;

      if (argv.help) {
        process.stdout.write(opt.help());
        process.exit(1);
      }

      requireDirInApp("run");
      runner.run(context, {
        port: new_argv.port,
        noMinify: !new_argv.production,
        once: new_argv.once,
        settingsFile: new_argv.settings
      });
    }
  });

  Commands.push({
    name: "test-packages",
    help: "Test one or more packages",
    func: function (argv) {
      // reparse args
      // This help logic should probably move to run.js eventually
      var opt = require('optimist')
            .alias('port', 'p').default('port', 3000)
            .describe('port', 'Port to listen on. NOTE: Also uses port N+1 and N+2.')
            .describe('deploy', 'Optionally, specify a domain to deploy to, rather than running locally.')
            .boolean('once') // See #Once
            .usage(
              "Usage: \n" +
                "\n" +
                "meteor test-packages [--release=x.y.z] --package-dir=<path to local package> [options]\n" +
                "    Runs unit tests on one package located on disk.\n" +
                "\n" +
                "meteor test-packages [--release=x.y.z] [options] [package...]\n" +
                "    Runs unit tests for a set of packages.\n" +
                "\n" +
                "Point your browser to localhost:3000 to run tests and see results.\n");

      var new_argv = opt.argv;

      if (argv.help) {
        process.stdout.write(opt.help());
        process.exit(1);
      }

      var testPackages;
      if (new_argv["package-dir"]) {
        // Use path.resolve to strip trailing path.sep, so we don't get a
        // package named "foo/".
        var packageDir = path.resolve(new_argv["package-dir"], ".");
        var packageName = path.basename(packageDir);
        testPackages = [packages.loadFromDir(packageName, packageDir)];
      } else if (!_.isEmpty(argv._)) {
        testPackages = argv._;
      } else {
        testPackages = _.keys(packages.list(context.packageSearchOptions));
      }

      // Note: runnerAppDir is not the same as
      // bundleOptions.packageSearchOptions.appDir: we are bundling the test
      // runner app, but finding app packages from the current app (if any).
      var runnerAppDir = path.join(__dirname, 'test-runner-app');

      if (new_argv.deploy) {
        var deployOptions = {
          site: new_argv.deploy
        };
        deploy.deployToServer(runnerAppDir, {
          nodeModulesMode: 'skip',
          testPackages: testPackages,
          noMinify: true,  // XXX provide a --production
          releaseStamp: context.releaseVersion,
          packageSearchOptions: context.packageSearchOptions
        }, {
          site: new_argv.deploy
        });
      } else {
        context.appDir = runnerAppDir;
        runner.run(context, {
          port: new_argv.port,
          noMinify: true,  // XXX provide a --production
          once: new_argv.once,
          testPackages: testPackages
        });
      }
    }
  });

  Commands.push({
    name: "help",
    func: function (argv) {
      if (!argv._.length || argv.help)
        usage();
      var cmd = argv._.splice(0,1)[0];
      argv.help = true;
      findCommand(cmd).func(argv);
    }
  });

  Commands.push({
    name: "create",
    help: "Create a new project",
    func: function (argv) {
      // reparse args
      var opt = require('optimist')
            .describe('example', 'Example template to use.')
            .boolean('list')
            .describe('list', 'Show list of available examples.')
            .usage(
              "Usage: meteor create <name>\n" +
                "       meteor create --example <example_name> [<name>]\n" +
                "       meteor create --list\n" +
                "\n" +
                "Make a subdirectory named <name> and create a new Meteor project\n" +
                "there. You can also pass an absolute or relative path.\n" +
                "\n" +
                "You can pass --example to start off with a copy of one of the Meteor\n" +
                "sample applications. Use --list to see the available examples.");

      var new_argv = opt.argv;
      var appPath;

      var example_dir = path.join(__dirname, '..', 'examples');
      var examples = _.reject(fs.readdirSync(example_dir), function (e) {
        return (e === 'unfinished' || e === 'other'  || e[0] === '.');
      });

      if (argv._.length === 1) {
        appPath = argv._[0];
      } else if (argv._.length === 0 && new_argv.example) {
        appPath = new_argv.example;
      }

      if (new_argv['list']) {
        process.stdout.write("Available examples:\n");
        _.each(examples, function (e) {
          process.stdout.write("  " + e + "\n");
        });
        process.stdout.write("\n" +
                             "Create a project from an example with 'meteor create --example <name>'.\n");
        process.exit(1);
      };

      if (argv.help || !appPath) {
        process.stdout.write(opt.help());
        process.exit(1);
      }

      if (fs.existsSync(appPath)) {
        process.stderr.write(appPath + ": Already exists\n");
        process.exit(1);
      }

      if (files.findAppDir(appPath)) {
        process.stderr.write(
          "You can't create a Meteor project inside another Meteor project.\n");
        process.exit(1);
      }

      var transform = function (x) {
        return x.replace(/~name~/g, path.basename(appPath));
      };

      if (new_argv.example) {
        if (examples.indexOf(new_argv.example) === -1) {
          process.stderr.write(new_argv.example + ": no such example\n\n");
          process.stderr.write("List available applications with 'meteor create --list'.\n");
          process.exit(1);
        } else {
          files.cp_r(path.join(example_dir, new_argv.example), appPath, {
            ignore: [/^local$/]
          });
        }
      } else {
        files.cp_r(path.join(__dirname, 'skel'), appPath, {
          transform_filename: function (f) {
            return transform(f);
          },
          transform_contents: function (contents, f) {
            if ((/(\.html|\.js|\.css)/).test(f))
              return new Buffer(transform(contents.toString()));
            else
              return contents;
          },
          ignore: [/^local$/]
        });
      }

      project.writeMeteorReleaseVersion(appPath, context.releaseVersion);

      process.stderr.write(appPath + ": created");
      if (new_argv.example &&
          new_argv.example !== appPath)
        process.stderr.write(" (from '" + new_argv.example + "' template)");
      process.stderr.write(".\n\n");

      process.stderr.write(
        "To run your new app:\n" +
          "   cd " + appPath + "\n" +
          "   meteor\n");
    }
  });

  Commands.push({
    name: "update",
    help: "Upgrade to the latest version of Meteor",
    func: function (argv) {
      // reparse args
      var opt = require('optimist')
            .usage(
              "Usage: meteor update\n" +
                "\n" +
                "Checks to see if a new version of Meteor is available, and if so,\n" +
                "downloads and installs it. You must be connected to the internet.\n");

      if (opt.argv.help) {
        process.stdout.write(opt.help());
        process.exit(1);
      }

      // refuse to update if we're in a git checkout.
      if (!files.usesWarehouse()) {
        console.log("Your Meteor installation is a git checkout. Update it " +
                    "manually with 'git pull'.");
        process.exit(1);
      }

      if (opt.argv.release) {
        // The user specified a specific release, so we don't need to do a
        // global update, and we don't need to springboard because if we needed
        // to, we already would have done that back in main().
      } else {
        // XXX think carefully about what happens if we double-update
        var updatedFrom = opt.argv['updated-from'] || context.releaseVersion;

        var didUpdate = warehouse.fetchLatestRelease();

        // we need to update the global releaseVersion variable
        // because that's what toolsSpringboard reads
        context.releaseVersion = warehouse.latestRelease();

        // XXX make errors look good
        if (didUpdate) {
          console.log("Updated Meteor to release " + context.releaseVersion + ".");
          toolsSpringboard(['--updated-from=' + updatedFrom]);
          // If the tools for release is different, then toolsSpringboard
          // execs and does not return. Otherwise, keeps going.
        }

        if (updatedFrom !== context.releaseVersion) {
          // XXX this next line is WRONG, which suggests that the logic for
          // updatedFrom is wrong. (updatedFrom can be an app's version, not
          // just global version.)
          toolsDebugMessage("Globally updated from " + updatedFrom + " to "
                             + context.releaseVersion);
          // ... here is a chance to update the bootstrap script, etc
          // ... maybe print out some release notes or something
          // ... etc
        } else {
          console.log("Meteor release " + warehouse.latestRelease() +
                      " is already the latest release.");
        }
      }

      // If we're not in an app, then we're done. Otherwise, we have to upgrade
      // the app too.
      if (!context.appDir) {
        // If we weren't fetching the latest release, then we haven't printed
        // anything yet (other than possibly in main), so we should print
        // something now.
        if (opt.argv.release) {
          console.log("Meteor release " + context.releaseVersion + " is installed.");
        }
        return;
      }

      var appRelease = project.getMeteorReleaseVersion(context.appDir);
      // Write release version unconditionally, so that we write it even if
      // appRelease === releaseVersion === the implicit 0.6.0 from a missing
      // file.
      project.writeMeteorReleaseVersion(context.appDir, context.releaseVersion);
      if (appRelease === context.releaseVersion) {
        // XXX this is wrong if we just updated from no file to 0.6.0.
        console.log("Your app is already running Meteor release "
                    + context.releaseVersion + ".");
        return;
      }

      // This is the right spot to do any other changes we need to the app in
      // order to update it for the new release (new metadata file formats,
      // etc, or maybe even updating renamed APIs).
      // XXX should we really print the full path here (appDir)?
      console.log("Updated app '%s' to release %s from release %s.",
                  context.appDir, context.releaseVersion, appRelease);
      console.log();

      warehouse.printChangelog(appRelease, context.releaseVersion);
    }
  });

  Commands.push({
    name: "add",
    help: "Add a package to this project",
    func: function (argv) {
      if (argv.help || !argv._.length) {
        process.stdout.write(
          "Usage: meteor add <package> [package] [package..]\n" +
            "\n" +
            "Adds packages to your Meteor project. You can add multiple\n" +
            "packages with one command. For a list of the available packages, see\n" +
            "'meteor list'.\n");
        process.exit(1);
      }

      requireDirInApp('add');
      var all = packages.list(context.packageSearchOptions);
      var using = {};
      _.each(project.get_packages(context.appDir), function (name) {
        using[name] = true;
      });

      _.each(argv._, function (name) {
        if (!(name in all)) {
          process.stderr.write(name + ": no such package\n");
        } else if (name in using) {
          process.stderr.write(name + ": already using\n");
        } else {
          project.add_package(context.appDir, name);
          var note = all[name].metadata.summary || '';
          process.stderr.write(name + ": " + note + "\n");
        }
      });
    }
  });

  Commands.push({
    name: "remove",
    help: "Remove a package from this project",
    func: function (argv) {
      if (argv.help || !argv._.length) {
        process.stdout.write(
          "Usage: meteor remove <package> [package] [package..]\n" +
            "\n" +
            "Removes a package previously added to your Meteor project. For a\n" +
            "list of the packages that your application is currently using, see\n" +
            "'meteor list --using'.\n");
        process.exit(1);
      }

      requireDirInApp('remove');
      var using = {};
      _.each(project.get_packages(context.appDir), function (name) {
        using[name] = true;
      });

      _.each(argv._, function (name) {
        if (!(name in using)) {
          process.stderr.write(name + ": not in project\n");
        } else {
          project.remove_package(context.appDir, name);
          process.stderr.write(name + ": removed\n");
        }
      });
    }
  });

  Commands.push({
    name: "list",
    help: "List available packages",
    func: function (argv) {
      if (argv.help) {
        process.stdout.write(
          "Usage: meteor list [--using]\n" +
            "\n" +
            "Without arguments, lists all available Meteor packages. To add one\n" +
            "of these packages to your project, see 'meteor add'.\n" +
            "\n" +
            "With --using, list the packages that you have added to your project.\n");
        process.exit(1);
      }

      if (argv.using) {
        requireDirInApp('list --using');
        var using = project.get_packages(context.appDir);

        if (using.length) {
          _.each(using, function (name) {
            process.stdout.write(name + "\n");
          });
        } else {
          process.stderr.write(
            "This project doesn't use any packages yet. To add some packages:\n" +
              "  meteor add <package> <package> ...\n" +
              "\n" +
              "To see available packages:\n" +
              "  meteor list\n");
        }
        return;
      }

      requireDirInApp('list');
      var list = packages.list(context.packageSearchOptions);
      var names = _.keys(list);
      names.sort();
      var pkgs = [];
      _.each(names, function (name) {
        pkgs.push(list[name]);
      });
      process.stdout.write("\n" + packages.format_list(pkgs) + "\n");
    }
  });

  Commands.push({
    name: "bundle",
    help: "Pack this project up into a tarball",
    func: function (argv) {
      if (argv.help || argv._.length != 1) {
        process.stdout.write(
          "Usage: meteor bundle <output_file.tar.gz>\n" +
            "\n" +
            "Package this project up for deployment. The output is a tarball that\n" +
            "includes everything necessary to run the application. See README in\n" +
            "the tarball for details.\n");
        process.exit(1);
      }

      // XXX if they pass a file that doesn't end in .tar.gz or .tgz,
      // add the former for them

      // XXX output, to stderr, the name of the file written to (for
      // human comfort, especially since we might change the name)

      // XXX name the root directory in the bundle based on the basename
      // of the file, not a constant 'bundle' (a bit obnoxious for
      // machines, but worth it for humans)

      requireDirInApp("bundle");
      var buildDir = path.join(context.appDir, '.meteor', 'local', 'build_tar');
      var bundle_path = path.join(buildDir, 'bundle');
      var output_path = path.resolve(argv._[0]); // get absolute path

      var bundler = require(path.join(__dirname, 'bundler.js'));
      var errors = bundler.bundle(context.appDir, bundle_path, {
        nodeModulesMode: 'copy',
        releaseStamp: context.releaseVersion,
        packageSearchOptions: context.packageSearchOptions
      });
      if (errors) {
        process.stdout.write("Errors prevented bundling:\n");
        _.each(errors, function (e) {
          process.stdout.write(e + "\n");
        });
        files.rm_recursive(buildDir);
        process.exit(1);
      }

      var out = fs.createWriteStream(output_path);

      out.on('error', function (err) {
        console.log(JSON.stringify(err));
        process.stderr.write("Couldn't create tarball\n");
      });
      out.on('close', function () {
        files.rm_recursive(buildDir);
      });

      files.createTarGzStream(path.join(buildDir, 'bundle')).pipe(out);
    }
  });

  Commands.push({
    name: "mongo",
    help: "Connect to the Mongo database for the specified site",
    func: function (argv) {
      var opt = require('optimist')
            .boolean('url')
            .boolean('U')
            .alias('url', 'U')
            .describe('url', 'return a Mongo database URL')
            .usage(
              "Usage: meteor mongo [--url] [site]\n" +
                "\n" +
                "Opens a Mongo shell to view or manipulate collections.\n" +
                "\n" +
                "If site is specified, this is the hosted Mongo database for the deployed\n" +
                "Meteor site.\n" +
                "\n" +
                "If no site is specified, this is the current project's local development\n" +
                "database.  In this case, the current working directory must be a\n" +
                "Meteor project directory, and the Meteor application must already be\n" +
                "running.\n" +
                "\n" +
                "Instead of opening a shell, specifying --url (-U) will return a URL\n" +
                "suitable for an external program to connect to the database.  For remote\n" +
                "databases on deployed applications, the URL is valid for one minute.\n"
            );

      if (argv.help) {
        process.stdout.write(opt.help());
        process.exit(1);
      }

      var new_argv = opt.argv;

      if (new_argv._.length === 1) {
        // localhost mode
        find_mongo_port("mongo", function (mongod_port) {
          if (!mongod_port) {
            process.stdout.write(
              "mongo: Meteor isn't running.\n" +
                "\n" +
                "This command only works while Meteor is running your application\n" +
                "locally. Start your application first.\n");
            process.exit(1);
          }

          var mongo_url = "mongodb://127.0.0.1:" + mongod_port + "/meteor";

          if (new_argv.url)
            console.log(mongo_url);
          else
            deploy.run_mongo_shell(mongo_url);
        });

      } else if (new_argv._.length === 2) {
        // remote mode
        deploy.mongo(new_argv._[1], new_argv.url);

      } else {
        // usage
        process.stdout.write(opt.help());
        process.exit(1);
      }
    }
  });

  Commands.push({
    name: "deploy",
    help: "Deploy this project to Meteor",
    func: function (argv) {
      var opt = require('optimist')
            .alias('password', 'P')
            .boolean('password')
            .boolean('P')
            .describe('password', 'set a password for this deployment')
            .alias('delete', 'D')
            .boolean('delete')
            .boolean('D')
            .describe('delete', "permanently delete this deployment")
            .boolean('debug')
            .describe('debug', 'deploy in debug mode (don\'t minify, etc)')
            .describe('settings', 'set optional data for Meteor.settings')
            .usage(
              "Usage: meteor deploy <site> [--password] [--settings settings.json] [--debug] [--delete]\n" +
                "\n" +
                "Deploys the project in your current directory to Meteor's servers.\n" +
                "\n" +
                "You can deploy to any available name under 'meteor.com'\n" +
                "without any additional configuration, for example,\n" +
                "'myapp.meteor.com'. If you deploy to a custom domain, such as\n" +
                "'myapp.mydomain.com', then you'll also need to configure your domain's\n" +
                "DNS records. See the Meteor docs for details.\n" +
                "\n" +
                "The --settings flag can be used to pass deploy-specific information to\n" +
                "the application. It will be available at runtime in Meteor.settings, but only\n" +
                "on the server. If the object contains a key named 'public', then\n" +
                "Meteor.settings.public will also be available on the client. The argument\n" +
                "is the name of a file containing the JSON data to use. The settings will\n" +
                "persist across deployments until you again specify a settings file. To\n" +
                "unset Meteor.settings, pass an empty settings file.\n" +
                "\n" +
                "The --delete flag permanently removes a deployed application, including\n" +
                "all of its stored data.\n" +
                "\n" +
                "The --password flag sets an administrative password for the domain. Once\n" +
                "set, any subsequent 'deploy', 'logs', or 'mongo' command will prompt for\n" +
                "the password. You can change the password with a second 'deploy' command."
            );

      var new_argv = opt.argv;

      if (argv.help || new_argv._.length != 2) {
        process.stdout.write(opt.help());
        process.exit(1);
      }

      if (new_argv.delete) {
        deploy.delete_app(new_argv._[1]);
      } else {
        var settings = undefined;
        if (new_argv.settings)
          settings = runner.getSettings(new_argv.settings);
        requireDirInApp("deploy");
        deploy.deployCmd({
          url: new_argv._[1],
          appDir: context.appDir,
          settings: settings,
          setPassword: !!new_argv.password,
          bundleOptions: {
            nodeModulesMode: 'skip',
            noMinify: !!new_argv.debug,
            releaseStamp: context.releaseVersion,
            packageSearchOptions: context.packageSearchOptions
          }
        });
      }
    }
  });

  Commands.push({
    name: "logs",
    help: "Show logs for specified site",
    func: function (argv) {
      if (argv.help || argv._.length < 1 || argv._.length > 2) {
        process.stdout.write(
          "Usage: meteor logs <site>\n" +
            "\n" +
            "Retrieves the server logs for the requested site.\n");
        process.exit(1);
      }

      deploy.logs(argv._[0]);
    }
  });

  Commands.push({
    name: "reset",
    help: "Reset the project state. Erases the local database.",
    func: function (argv) {
      if (argv.help) {
        process.stdout.write(
          "Usage: meteor reset\n" +
            "\n" +
            "Reset the current project to a fresh state. Removes all local\n" +
            "data and kills any running meteor development servers.\n");
        process.exit(1);
      } else if (!_.isEmpty(argv._)) {
        process.stdout.write("meteor reset only affects the locally stored database.\n\n" +
                             "To reset a deployed application use\nmeteor deploy --delete appname\n" +
                             "followed by\nmeteor deploy appname\n");
        process.exit(1);
      }

      find_mongo_port("reset", function (mongod_port) {
        if (mongod_port) {
          process.stdout.write(
            "reset: Meteor is running.\n" +
              "\n" +
              "This command does not work while Meteor is running your application.\n" +
              "Exit the running meteor development server.\n");
          process.exit(1);
        }

        var local_dir = path.join(context.appDir, '.meteor', 'local');
        files.rm_recursive(local_dir);

        process.stdout.write("Project reset.\n");
      });
    }
  });

  // Prints a message if $METEOR_TOOLS_DEBUG is set.
  // XXX We really should have a better logging system.
  var toolsDebugMessage = function (msg) {
    if (process.env.METEOR_TOOLS_DEBUG)
      console.log("[TOOLS DEBUG] " + msg);
  };

  // As the first step of running the Meteor CLI, check which Meteor
  // release we should be running against. Then, check whether the
  // tools corresponding to that release is the same as the one
  // we're running. If not, springboard to the right tools (after
  // having fetched it to the local warehouse)
  var toolsSpringboard = function (extraArgs) {
    if (context.releaseManifest.tools === files.getToolsVersion())
      return;

    toolsDebugMessage("springboarding from " + files.getToolsVersion() +
                      " to " + context.releaseManifest.tools);

    // Strip off the "node" and "meteor.js" from argv and replace it with the
    // appropriate tools's meteor shell script.
    var newArgv = process.argv.slice(2);
    newArgv.unshift(
      path.join(warehouse.getToolsDir(context.releaseManifest.tools),
                'bin', 'meteor'));
    if (extraArgs)
      newArgv.push.apply(newArgv, extraArgs);

    // Now shell quote this (because kexec wants to use /bin/sh -c) and execvp.
    // XXX fork kexec and make it take an array instead of using shell
    var quotedArgv = require('shell-quote').quote(newArgv);
    require('kexec')(quotedArgv);
  };

  var printVersion = function () {
    if (files.usesWarehouse()) {
      console.log("Release " + context.releaseVersion);
      process.exit(0);
    }

    if (context.appDir) {
      die("This project was created with a checkout of Meteor, rather than an\n" +
          "official release, and doesn't have a release number associated with\n" +
          "it. You can set its release with 'meteor update'.");
    } else {
      die("Unreleased (running from a checkout)");
    }
  };

  var main = function() {
    var optimist = require('optimist')
          .alias("h", "help")
          .boolean("h")
          .boolean("help")
          .boolean("version")
          .boolean("debug");

    var argv = optimist.argv;

    calculateContext(argv);

    // if we're not running the correct tools, fetch it and
    // re-run. do *not* do this if we are in a checkout, or if
    // process.env.TEST_WAREHOUSE_DIR is set. This hook allows unit
    // tests to test the current tools's ability to run other
    // releases.
    if (!files.in_checkout() && !process.env.TEST_WAREHOUSE_DIR)
      toolsSpringboard();

    if (argv.help) {
      argv._.splice(0, 0, "help");
      delete argv.help;
    }

    if (argv.version) {
      printVersion();
      return;
    }

    var cmd = 'run';
    if (argv._.length)
      cmd = argv._.splice(0,1)[0];

    findCommand(cmd).func(argv);
  };

  main();
}).run();