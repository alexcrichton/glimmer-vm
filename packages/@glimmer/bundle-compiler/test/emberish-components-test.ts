import { EmberishGlimmerComponent, rawModule, EmberishComponentTests, EagerRenderDelegate, test } from "@glimmer/test-helpers";

class BundleCompilerEmberTests extends EmberishComponentTests {
  @test({ kind: 'glimmer' })
  "should only serialize a single locator"() {
    this.registerComponent('Glimmer', 'A', '{{component "B" foo=@bar}} {{component "B" foo=2}} {{component "B" foo=3}}');
    this.registerComponent('Glimmer', 'B', 'B {{@foo}}');
    this.render('<A @bar={{1}} /> {{component "B" foo=4}}');
    let locator = JSON.stringify({ locator: { module: 'ui/components/B', name: 'default' } });
    let { strings } = this.delegate.constants!.toPool();
    this.assert.ok(strings.indexOf(locator) > 0);

    let uniq: string[] = [];
    strings.forEach((str) => {
      if (str === locator) {
        uniq.push(str);
      }
    });

    this.assert.equal(uniq.length, 1);

    this.assertHTML('B 1 B 2 B 3 B 4');
    this.assertStableRerender();
  }

  @test({ kind: 'glimmer' })
  "should not serialize if there are no args"() {
    class B extends EmberishGlimmerComponent {
      bar = 1;
    }
    this.registerComponent('Glimmer', 'A', '{{component "B"}}');
    this.registerComponent('Glimmer', 'B', 'B {{bar}}', B);
    this.render('<A /> {{component "B"}}');
    let locator = JSON.stringify({ locator: { module: 'ui/components/B', name: 'default' } });
    let { strings } = this.delegate.constants!.toPool();
    this.assert.equal(strings.indexOf(locator), -1);
    this.assertHTML('B 1 B 1');
    this.assertStableRerender();
  }
}

rawModule('[Bundle Compiler] Emberish Components', BundleCompilerEmberTests, EagerRenderDelegate, { componentModule: true });
