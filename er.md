(.venv) PS C:\Dev\Androidapp\backend> python manage.py collectstatic --noinput
Firebase Admin SDK initialized successfully.
Traceback (most recent call last):
  File "C:\Dev\Androidapp\backend\manage.py", line 22, in <module>
    main()
  File "C:\Dev\Androidapp\backend\manage.py", line 18, in main
    execute_from_command_line(sys.argv)
  File "C:\Dev\Androidapp\.venv\Lib\site-packages\django\core\management\__init__.py", line 443, in execute_from_command_line
    utility.execute()
  File "C:\Dev\Androidapp\.venv\Lib\site-packages\django\core\management\__init__.py", line 437, in execute
    self.fetch_command(subcommand).run_from_argv(self.argv)
  File "C:\Dev\Androidapp\.venv\Lib\site-packages\django\core\management\base.py", line 420, in run_from_argv
    self.execute(*args, **cmd_options)
  File "C:\Dev\Androidapp\.venv\Lib\site-packages\django\core\management\base.py", line 464, in execute
    output = self.handle(*args, **options)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Dev\Androidapp\.venv\Lib\site-packages\django\contrib\staticfiles\management\commands\collectstatic.py", line 214, in handle
    collected = self.collect()
                ^^^^^^^^^^^^^^
  File "C:\Dev\Androidapp\.venv\Lib\site-packages\django\contrib\staticfiles\management\commands\collectstatic.py", line 137, in collect
    handler(path, prefixed_path, storage)
  File "C:\Dev\Androidapp\.venv\Lib\site-packages\cloudinary_storage\management\commands\collectstatic.py", line 27, in copy_file
    if (settings.STATICFILES_STORAGE == 'cloudinary_storage.storage.StaticCloudinaryStorage' or
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  File "C:\Dev\Androidapp\.venv\Lib\site-packages\django\conf\__init__.py", line 77, in __getattr__
    val = getattr(_wrapped, name)
          ^^^^^^^^^^^^^^^^^^^^^^^
AttributeError: 'Settings' object has no attribute 'STATICFILES_STORAGE'. Did you mean: 'STATICFILES_DIRS'?
(.venv) PS C:\Dev\Androidapp\backend> python manage.py collectstatic --noinput
Firebase Admin SDK initialized successfully.

0 static files copied to 'C:\Dev\Androidapp\backend\staticfiles'.
(.venv) PS C:\Dev\Androidapp\backend> 