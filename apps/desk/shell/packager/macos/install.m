// Install the app from a disk image into a writable Applications folder, including a user-renamed
// Desk. The signed bundle identifier and executable identify the app independently of its filename.
#import <Foundation/Foundation.h>
#import <Security/Security.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

static NSString *const appID = @"ai.endue.desk";
static NSFileManager *files(void) { return NSFileManager.defaultManager; }

static int refuse(NSString *reason) {
    fprintf(stderr, "endue: %s\n", reason.UTF8String);
    return 1;
}

static BOOL present(NSURL *url, struct stat *info) {
    return lstat(url.fileSystemRepresentation, info) == 0;
}

static BOOL ours(NSURL *url) {
    struct stat info;
    if (!present(url, &info) || !S_ISDIR(info.st_mode)) return NO;
    NSURL *plist = [url URLByAppendingPathComponent:@"Contents/Info.plist"];
    NSDictionary *metadata = [NSDictionary dictionaryWithContentsOfURL:plist];
    return [metadata[@"CFBundleIdentifier"] isEqual:appID] &&
           [metadata[@"CFBundleExecutable"] isEqual:@"endue-desk"];
}

static BOOL sealed(NSURL *url) {
    SecStaticCodeRef code = NULL;
    OSStatus status = SecStaticCodeCreateWithPath((__bridge CFURLRef)url, kSecCSDefaultFlags, &code);
    if (status != errSecSuccess) return NO;
    status = SecStaticCodeCheckValidity(code, kSecCSStrictValidate | kSecCSCheckAllArchitectures |
                                       kSecCSCheckNestedCode, NULL);
    CFRelease(code);
    return status == errSecSuccess;
}

static int install(NSURL *source, NSURL *folder, NSURL *chosen) {
    NSError *error = nil;
    if (!ours(source) || !sealed(source)) return refuse(@"The source app's identity or signature is invalid.");
    NSURL *target = chosen;
    if (!target) {
        NSArray *entries = [files() contentsOfDirectoryAtURL:folder includingPropertiesForKeys:nil
                                                     options:NSDirectoryEnumerationSkipsHiddenFiles error:&error];
        if (!entries) return refuse(error.localizedDescription);
        for (NSURL *entry in entries) {
            if ([entry.pathExtension caseInsensitiveCompare:@"app"] != NSOrderedSame || !ours(entry)) continue;
            if (target) return refuse(@"Several Desk installations were found. Choose one with --to.");
            target = entry;
        }
        if (!target) target = [folder URLByAppendingPathComponent:@"endue.app"];
    }
    if ([target.pathExtension caseInsensitiveCompare:@"app"] != NSOrderedSame ||
        [target.URLByResolvingSymlinksInPath.path isEqual:source.URLByResolvingSymlinksInPath.path])
        return refuse(@"Choose a destination .app outside the disk image.");
    struct stat before;
    BOOL updating = present(target, &before);
    if (updating && (!ours(target) || !sealed(target)))
        return refuse(@"Another app or file occupies that location. Choose an available .app path with --to.");
    if (!updating && errno != ENOENT) return refuse(@"The destination could not be inspected.");

    NSString *pattern = [[target.URLByDeletingLastPathComponent path] stringByAppendingPathComponent:@".endue-install.XXXXXX"];
    char *buffer = strdup(pattern.fileSystemRepresentation);
    if (!buffer) return refuse(@"Could not allocate a staging path.");
    char *path = mkdtemp(buffer);
    if (!path) { free(buffer); return refuse(@"Cannot stage the app here. Choose a writable Applications folder."); }
    NSURL *temporary = [NSURL fileURLWithFileSystemRepresentation:path isDirectory:YES relativeToURL:nil];
    free(buffer);
    NSURL *stage = [temporary URLByAppendingPathComponent:@"endue.app"];
    int result = 1;
    if (![files() copyItemAtURL:source toURL:stage error:&error]) {
        refuse(error.localizedDescription);
    } else if (!ours(stage) || !sealed(stage)) {
        refuse(@"The copied app did not pass signature verification.");
    } else {
        struct stat current;
        BOOL same = !updating || (present(target, &current) &&
                    current.st_dev == before.st_dev && current.st_ino == before.st_ino);
        if (!same || renamex_np(stage.fileSystemRepresentation, target.fileSystemRepresentation,
                                updating ? RENAME_SWAP : RENAME_EXCL) != 0) {
            refuse(@"The destination changed during installation. Check the location and try again.");
        } else {
            printf("Installed endue at %s\n", target.fileSystemRepresentation);
            result = 0;
        }
    }
    [files() removeItemAtURL:temporary error:NULL];
    return result;
}

int main(int argc, char **argv) {
    @autoreleasepool {
        NSURL *folder = [NSURL fileURLWithPath:@"/Applications" isDirectory:YES];
        NSURL *chosen = nil;
        for (int i = 1; i < argc; i++) {
            NSString *option = [NSString stringWithUTF8String:argv[i]];
            if (i + 1 >= argc || (![option isEqual:@"--apps-dir"] && ![option isEqual:@"--to"]))
                return refuse(@"Usage: install-endue [--apps-dir FOLDER] [--to /path/to/Chosen.app]");
            NSString *arg = [NSString stringWithUTF8String:argv[++i]];
            if (!arg.isAbsolutePath) return refuse(@"Choose an absolute installation path.");
            NSURL *url = [NSURL fileURLWithPath:arg.stringByStandardizingPath];
            if ([option isEqual:@"--to"]) chosen = url;
            else folder = url;
        }
        NSURL *parent = chosen ? chosen.URLByDeletingLastPathComponent : folder;
        int lock = open(parent.fileSystemRepresentation, O_RDONLY | O_DIRECTORY);
        if (lock == -1 || flock(lock, LOCK_EX) == -1)
            return refuse(@"Cannot open the destination folder. Choose an existing writable folder.");
        NSURL *tool = [NSURL fileURLWithPath:NSProcessInfo.processInfo.arguments.firstObject].URLByResolvingSymlinksInPath;
        NSURL *source = tool.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent.URLByDeletingLastPathComponent;
        int status = install(source, folder, chosen);
        close(lock);
        return status;
    }
}
