from mogo.github.diffmap import commentable_lines

DIFF = """diff --git a/src/a.ts b/src/a.ts
index 1..2 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
-old
+new
+added
 line4
@@ -10,2 +11,3 @@
 ctx
+tail
 end
diff --git a/gone.ts b/gone.ts
deleted file mode 100644
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-x
-y
"""


def test_added_and_context_lines_are_commentable():
    m = commentable_lines(DIFF)
    assert m["src/a.ts"] == {1, 2, 3, 4, 11, 12, 13}


def test_deleted_files_have_no_lines():
    assert "gone.ts" not in commentable_lines(DIFF)


def test_removed_line_starting_with_dashes_is_not_a_header():
    diff = "diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1,2 +1,1 @@\n--- not a header\n keep\n"
    assert commentable_lines(diff)["f"] == {1}
