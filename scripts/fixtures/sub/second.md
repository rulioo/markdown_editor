# 第二个实例打开的文件

这个文件放在**子目录**里，是为了让「窗口已开时再打开一个文件」的验证有区分度：
如果 `openExternalPaths` 里那句 `if (!workspace.hasWorkspace)` 守卫失效，
侧栏根目录会从 `scripts/fixtures` 变成 `scripts/fixtures/sub`——一眼就能看出来。

- 列表项一
- 列表项二
